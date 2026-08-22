const express = require('express');
const Tank = require('../models/Tank');
const TankDipLog = require('../models/TankDipLog');
const TankReceipt = require('../models/TankReceipt');
const Nozzle = require('../models/Nozzle');
const Reading = require('../models/Reading');
const { verifyToken, requireRole } = require('../middleware/auth');
const { dipToLiters, monthYearRange, dayRange } = require('../utils/dip');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  const tanks = await Tank.find().populate('fuelType').sort({ name: 1 });
  res.json(
    tanks.map((t) => ({
      id: t._id,
      name: t.name,
      totalVolume: t.totalVolume,
      fuelType: t.fuelType,
      hasGrid: t.grid.length > 0,
    }))
  );
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, totalVolume, fuelType } = req.body;
    if (!name || typeof totalVolume !== 'number') {
      return res.status(400).json({ message: 'name and totalVolume are required' });
    }

    const existing = await Tank.findOne({ name });
    if (existing) return res.status(409).json({ message: 'A tank with this name already exists' });

    const tank = await Tank.create({ name, totalVolume, fuelType: fuelType || null });
    res.status(201).json(tank);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, totalVolume, fuelType } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (totalVolume !== undefined) update.totalVolume = totalVolume;
    if (fuelType !== undefined) update.fuelType = fuelType || null;

    const tank = await Tank.findByIdAndUpdate(req.params.id, update, {
      returnDocument: 'after',
    });
    if (!tank) return res.status(404).json({ message: 'Tank not found' });

    res.json(tank);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Bulk import/replace the dip chart grid for a tank. Body: { grid: [[...10 numbers], ...] }
// grid[row][col] must be the liters value at dip = row*10 + col, exactly as printed on the chart.
router.put('/:id/grid', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { grid } = req.body;
    if (!Array.isArray(grid) || grid.length === 0) {
      return res.status(400).json({ message: 'grid must be a non-empty array of rows' });
    }
    for (const row of grid) {
      if (!Array.isArray(row) || row.length !== 10 || row.some((v) => typeof v !== 'number')) {
        return res.status(400).json({ message: 'Every row must have exactly 10 numeric values' });
      }
    }

    const tank = await Tank.findByIdAndUpdate(
      req.params.id,
      { grid },
      { returnDocument: 'after' }
    );
    if (!tank) return res.status(404).json({ message: 'Tank not found' });

    res.json(tank);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/:id/dip', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  const reading = Number(req.query.reading);
  if (!Number.isFinite(reading) || reading < 0) {
    return res.status(400).json({ message: 'reading query param must be a non-negative number' });
  }

  const tank = await Tank.findById(req.params.id);
  if (!tank) return res.status(404).json({ message: 'Tank not found' });
  if (tank.grid.length === 0) {
    return res.status(409).json({ message: 'This tank has no dip chart imported yet' });
  }

  const liters = dipToLiters(tank.grid, reading);
  if (liters == null) {
    return res.status(400).json({ message: 'Reading is outside the imported chart range' });
  }

  res.json({ dipReading: reading, liters });
});

router.post('/:id/dip-log', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { date, dipReading } = req.body;
    if (!date || typeof dipReading !== 'number' || dipReading < 0) {
      return res.status(400).json({ message: 'date and dipReading are required' });
    }

    const tank = await Tank.findById(req.params.id);
    if (!tank) return res.status(404).json({ message: 'Tank not found' });
    if (tank.grid.length === 0) {
      return res.status(409).json({ message: 'This tank has no dip chart imported yet' });
    }

    const existing = await TankDipLog.findOne({
      tank: tank._id,
      date: dayRange(new Date(date)),
    });
    if (existing) {
      return res
        .status(409)
        .json({ message: 'You cannot add twice on same date. A dip reading already exists for this date.' });
    }

    const liters = dipToLiters(tank.grid, dipReading);
    if (liters == null) {
      return res.status(400).json({ message: 'Reading is outside the imported chart range' });
    }

    const log = await TankDipLog.create({
      tank: tank._id,
      date: new Date(date),
      dipReading,
      liters,
      enteredBy: req.user.id,
    });

    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Optional ?month=1-12&year=YYYY narrows results to that calendar month,
// for building the monthly dip register report.
router.get('/:id/dip-log', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  const filter = { tank: req.params.id };
  const range = monthYearRange(req.query);
  if (range) filter.date = range;

  const logs = await TankDipLog.find(filter)
    .populate('enteredBy', 'username name')
    .sort({ date: 1 });
  res.json(logs);
});

// A fuel delivery received into this tank on a given date.
router.post('/:id/receipt', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { date, quantity } = req.body;
    if (!date || !Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ message: 'date is required and quantity must be a non-negative integer' });
    }

    const tank = await Tank.findById(req.params.id);
    if (!tank) return res.status(404).json({ message: 'Tank not found' });

    const receipt = await TankReceipt.create({
      tank: tank._id,
      date: new Date(date),
      quantity,
      enteredBy: req.user.id,
    });

    res.status(201).json(receipt);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Optional ?month=1-12&year=YYYY narrows results to that calendar month.
router.get('/:id/receipt', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  const filter = { tank: req.params.id };
  const range = monthYearRange(req.query);
  if (range) filter.date = range;

  const receipts = await TankReceipt.find(filter)
    .populate('enteredBy', 'username name')
    .sort({ date: 1 });
  res.json(receipts);
});

// Daily Stock Report: for each day of the month, reconciles opening stock,
// receipts, meter sales (net of pump test), and dip-measured sales/variance
// — matching the paper DSR register (Opening/Receipt/Total/Sales by
// Meter/Pump Test/Net Sales/Cumulative Sales/Sales by Dip/Variation).
router.get('/:id/dsr', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
      return res.status(400).json({ message: 'month and year query params are required' });
    }

    const tank = await Tank.findById(req.params.id).populate('fuelType');
    if (!tank) return res.status(404).json({ message: 'Tank not found' });
    if (!tank.fuelType) {
      return res.status(409).json({ message: 'This tank is not linked to a fuel type' });
    }

    const nozzles = await Nozzle.find({ fuelType: tank.fuelType._id });
    const nozzleIds = nozzles.map((n) => n._id);

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    // Don't project opening stock into days that haven't happened yet — for
    // the current month, stop at today so an entry made on, say, the 11th
    // doesn't get carried forward as a static "opening stock" through the
    // rest of the month.
    const today = new Date();
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
    const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

    const readings = await Reading.find({
      nozzle: { $in: nozzleIds },
      closing: { $ne: null },
      closedAt: { $gte: start, $lt: end },
    });

    const salesByDay = {};
    const testByDay = {};
    for (const r of readings) {
      const day = r.closedAt.getDate();
      salesByDay[day] = (salesByDay[day] || 0) + r.litersSold;
      testByDay[day] = (testByDay[day] || 0) + (r.testingLiters || 0);
    }

    const receipts = await TankReceipt.find({ tank: tank._id, date: { $gte: start, $lt: end } });
    const receiptByDay = {};
    for (const rc of receipts) {
      const day = rc.date.getDate();
      receiptByDay[day] = (receiptByDay[day] || 0) + rc.quantity;
    }

    const dipLogs = await TankDipLog.find({ tank: tank._id, date: { $gte: start, $lt: end } }).sort({
      date: 1,
    });
    const dipByDay = {};
    for (const d of dipLogs) {
      dipByDay[d.date.getDate()] = d.liters;
    }

    // Baseline: the most recent dip reading before this month becomes day 1's opening stock.
    const previousDip = await TankDipLog.findOne({ tank: tank._id, date: { $lt: start } }).sort({
      date: -1,
    });
    let carryStock = previousDip ? previousDip.liters : null;

    let cumulativeSales = 0;
    let cummVariation = 0;
    const days = [];

    for (let day = 1; day <= lastDay; day++) {
      const openingStock = carryStock;
      const receipt = receiptByDay[day] || 0;
      const totalStock = openingStock == null ? null : openingStock + receipt;

      const salesByMeter = salesByDay[day] || 0;
      const pumpTest = testByDay[day] || 0;
      const netSalesByMeter = salesByMeter - pumpTest;
      cumulativeSales += netSalesByMeter;

      const dipStock = Object.prototype.hasOwnProperty.call(dipByDay, day) ? dipByDay[day] : null;
      const salesByDip = totalStock != null && dipStock != null ? totalStock - dipStock : null;
      const dailyVariation = salesByDip != null ? netSalesByMeter - salesByDip : null;
      if (dailyVariation != null) cummVariation += dailyVariation;

      days.push({
        day,
        openingStock,
        receipt,
        totalStock,
        salesByMeter,
        pumpTest,
        netSalesByMeter,
        cumulativeSales,
        dipStock,
        salesByDip,
        dailyVariation,
        cummVariation: dailyVariation != null ? cummVariation : null,
      });

      // Carry forward: the actual dip reading is authoritative; if none was
      // logged that day, project the closing stock from meter sales so the
      // chain survives gaps (a later dip reading resets it back to truth).
      carryStock =
        dipStock != null ? dipStock : totalStock != null ? totalStock - netSalesByMeter : null;
    }

    res.json({ tank: { id: tank._id, name: tank.name }, month, year, days });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Meter Reading report: per nozzle, each day's closing meter reading (the
// last closing of that calendar day — a same-day shift-change closing does
// not count as its own row) and that day's sale = today's closing minus the
// most recent previous day's closing, so intra-day shift changes telescope
// correctly into the daily total.
router.get(
  '/:id/meter-readings',
  verifyToken,
  requireRole('admin', 'manager', 'accountant'),
  async (req, res) => {
    try {
      const month = Number(req.query.month);
      const year = Number(req.query.year);
      if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: 'month and year query params are required' });
      }

      const tank = await Tank.findById(req.params.id).populate('fuelType');
      if (!tank) return res.status(404).json({ message: 'Tank not found' });
      if (!tank.fuelType) {
        return res.status(409).json({ message: 'This tank is not linked to a fuel type' });
      }

      const nozzles = await Nozzle.find({ fuelType: tank.fuelType._id }).sort({ name: 1 });

      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      const daysInMonth = new Date(year, month, 0).getDate();

      // Same current-month cutoff as the DSR report — don't project a
      // carried-forward reading into days that haven't happened yet.
      const today = new Date();
      const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
      const lastDay = isCurrentMonth ? today.getDate() : daysInMonth;

      const nozzleReports = [];

      for (const nozzle of nozzles) {
        const readings = await Reading.find({
          nozzle: nozzle._id,
          closing: { $ne: null },
          closedAt: { $gte: start, $lt: end },
        }).sort({ closedAt: 1 });

        // Keep only the last closing of each calendar day.
        const lastClosingByDay = {};
        for (const r of readings) {
          lastClosingByDay[r.closedAt.getDate()] = r.closing;
        }

        const previousReading = await Reading.findOne({
          nozzle: nozzle._id,
          closing: { $ne: null },
          closedAt: { $lt: start },
        }).sort({ closedAt: -1 });
        let carryReading = previousReading ? previousReading.closing : null;

        // No closed reading yet at all (a brand-new nozzle, or no sale since
        // it was set up) — fall back to the opening reading the admin set
        // when the nozzle was configured, so those early no-sale days show
        // that baseline instead of a blank. Only apply it from the day the
        // nozzle actually started existing.
        let baselineDay = 1;
        if (carryReading == null) {
          const firstReading = await Reading.findOne({ nozzle: nozzle._id }).sort({ createdAt: 1 });
          if (firstReading && firstReading.createdAt < end) {
            carryReading = firstReading.opening;
            if (firstReading.createdAt >= start) {
              baselineDay = firstReading.createdAt.getDate();
            }
          }
        }

        const days = [];
        for (let day = 1; day <= lastDay; day++) {
          // A day with no closing didn't get its own shift-close, but the
          // meter physically didn't move either — carry the last known
          // reading forward (zero sale that day) instead of leaving it blank.
          const hasClosing = Object.prototype.hasOwnProperty.call(lastClosingByDay, day);
          const reading = hasClosing ? lastClosingByDay[day] : day >= baselineDay ? carryReading : null;
          const sales = reading != null && carryReading != null ? reading - carryReading : null;
          days.push({ day, reading, sales });
          if (reading != null) carryReading = reading;
        }

        nozzleReports.push({ nozzleId: nozzle._id, nozzleName: nozzle.name, days });
      }

      res.json({ tank: { id: tank._id, name: tank.name }, month, year, nozzles: nozzleReports });
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }
);

module.exports = router;
