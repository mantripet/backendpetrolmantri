const express = require('express');
const Nozzle = require('../models/Nozzle');
const Unit = require('../models/Unit');
const Reading = require('../models/Reading');
const User = require('../models/User');
const { verifyToken, requireRole } = require('../middleware/auth');

const DENOMINATIONS = { n500: 500, n200: 200, n100: 100, n50: 50, n20: 20, n10: 10 };

function toNonNegativeNumber(value, fallback = 0) {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

const router = express.Router();

async function getActiveReading(nozzleId) {
  return Reading.findOne({ nozzle: nozzleId, closing: null });
}

router.get('/:id', verifyToken, async (req, res) => {
  const nozzle = await Nozzle.findById(req.params.id).populate('unit').populate('fuelType');
  if (!nozzle) return res.status(404).json({ message: 'Nozzle not found' });

  const activeReading = await getActiveReading(nozzle._id);
  res.json({ ...nozzle.toObject(), activeReading });
});

// Admin adds a nozzle to a dispensing unit, choosing which product it
// dispenses (HSD/MS/MSP/...). A machine swap from the company can bring a
// different mix of high/low-speed nozzles, so this is deliberately a
// per-nozzle choice rather than inherited from the unit.
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { unit, name, fuelType } = req.body;
    const trimmedName = (name || '').trim();
    if (!unit || !trimmedName || !fuelType) {
      return res.status(400).json({ message: 'unit, name and fuelType are required' });
    }

    const unitDoc = await Unit.findById(unit);
    if (!unitDoc) return res.status(404).json({ message: 'Unit not found' });

    const existing = await Nozzle.findOne({ unit, name: trimmedName });
    if (existing) {
      return res.status(409).json({ message: 'This unit already has a nozzle with this name' });
    }

    const nozzle = await Nozzle.create({ unit, name: trimmedName, fuelType });
    const populated = await nozzle.populate('fuelType');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin renames a nozzle and/or corrects its product. Changing the product
// only affects future closings — past readings already have their own
// pricePerLiter snapshot from when they were closed.
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, fuelType } = req.body;
    const nozzle = await Nozzle.findById(req.params.id);
    if (!nozzle) return res.status(404).json({ message: 'Nozzle not found' });

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) return res.status(400).json({ message: 'name cannot be empty' });

      const existing = await Nozzle.findOne({
        unit: nozzle.unit,
        name: trimmedName,
        _id: { $ne: nozzle._id },
      });
      if (existing) {
        return res.status(409).json({ message: 'This unit already has a nozzle with this name' });
      }
      nozzle.name = trimmedName;
    }

    if (fuelType !== undefined) {
      if (!fuelType) return res.status(400).json({ message: 'fuelType cannot be empty' });
      nozzle.fuelType = fuelType;
    }

    await nozzle.save();
    const populated = await nozzle.populate('fuelType');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin removes a nozzle — only if it has never been used for a reading, so
// sale/report history can never be silently dropped. A nozzle that's already
// been used should be renamed/reassigned instead of deleted.
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const readingCount = await Reading.countDocuments({ nozzle: req.params.id });
    if (readingCount > 0) {
      return res.status(409).json({
        message: 'This nozzle already has reading history and cannot be deleted. Rename it or change its product instead.',
      });
    }

    const nozzle = await Nozzle.findByIdAndDelete(req.params.id);
    if (!nozzle) return res.status(404).json({ message: 'Nozzle not found' });

    res.json({ message: 'Nozzle deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/:id/readings', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  const readings = await Reading.find({ nozzle: req.params.id }).sort({ createdAt: -1 });
  res.json(readings);
});

// Manager or admin sets the first-ever opening reading for a nozzle. Only
// allowed when there is no active (unclosed) reading yet for this nozzle.
router.post('/:id/opening', verifyToken, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const { reading } = req.body;
    if (typeof reading !== 'number' || reading < 0) {
      return res.status(400).json({ message: 'reading must be a non-negative number' });
    }

    const nozzle = await Nozzle.findById(req.params.id);
    if (!nozzle) return res.status(404).json({ message: 'Nozzle not found' });

    const existingActive = await getActiveReading(nozzle._id);
    if (existingActive) {
      return res.status(409).json({ message: 'This nozzle already has an active opening reading' });
    }

    const created = await Reading.create({
      nozzle: nozzle._id,
      opening: reading,
      openingSetBy: req.user.id,
    });

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin-only correction of the current active opening reading. No one else,
// including the manager who originally set it, may change it afterward.
router.put('/:id/opening', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { reading } = req.body;
    if (typeof reading !== 'number' || reading < 0) {
      return res.status(400).json({ message: 'reading must be a non-negative number' });
    }

    const active = await getActiveReading(req.params.id);
    if (!active) {
      return res.status(404).json({ message: 'No active opening reading for this nozzle' });
    }

    active.opening = reading;
    await active.save();

    res.json(active);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Worker closes out a nozzle's active reading for the shift. Workers are not
// assigned to a fixed nozzle — each day they pick whichever nozzle(s) they
// worked on. This single request carries the full shift-close payload: the
// closing meter reading, testing fuel used, the digital/khata payment
// breakdown, and (if handing over now) the counted cash denominations. A new
// active reading is opened automatically with opening = this closing value.
router.post('/:id/closing', verifyToken, requireRole('worker'), async (req, res) => {
  try {
    const { reading, testingLiters, payments, khataEntries, denominations, handedOverToManager } =
      req.body;

    if (typeof reading !== 'number' || reading < 0) {
      return res.status(400).json({ message: 'reading must be a non-negative number' });
    }

    const nozzle = await Nozzle.findById(req.params.id).populate('fuelType');
    if (!nozzle) return res.status(404).json({ message: 'Nozzle not found' });

    const active = await getActiveReading(nozzle._id);
    if (!active) {
      return res.status(400).json({ message: 'No opening reading has been set for this nozzle yet' });
    }

    if (reading < active.opening) {
      return res.status(400).json({ message: 'Closing reading cannot be less than the opening reading' });
    }

    const price = nozzle.fuelType.price;

    const litersSold = reading - active.opening;
    const amount = litersSold * price;

    const testLiters = toNonNegativeNumber(testingLiters, 0);
    if (testLiters > litersSold) {
      return res.status(400).json({ message: 'Testing liters cannot exceed liters sold' });
    }
    const testingAmount = testLiters * price;
    const netAmount = amount - testingAmount;

    const pay = payments || {};
    const phonePay = toNonNegativeNumber(pay.phonePay);
    const card = toNonNegativeNumber(pay.card);
    const dpPay = toNonNegativeNumber(pay.dpPay);
    const hpPay = toNonNegativeNumber(pay.hpPay);
    const paymentsTotal = phonePay + card + dpPay + hpPay;

    const entries = Array.isArray(khataEntries) ? khataEntries : [];
    for (const entry of entries) {
      if (!entry.customer) {
        return res.status(400).json({ message: 'Each khata entry requires a customer' });
      }
      if (entry.amount == null && entry.liters == null) {
        return res.status(400).json({ message: 'Each khata entry requires an amount or liters' });
      }
    }
    // Worker enters either the rupee amount or the liters for a khata entry;
    // whichever one is missing is derived from this nozzle's price so both
    // are always saved for the record.
    const normalizedEntries = entries.map((entry) => {
      let amount = entry.amount != null ? toNonNegativeNumber(entry.amount, null) : null;
      let liters = entry.liters != null ? toNonNegativeNumber(entry.liters, null) : null;
      if (amount == null && liters != null) amount = liters * price;
      if (liters == null && amount != null) liters = price > 0 ? amount / price : 0;

      return {
        customer: entry.customer,
        voucherNumber: entry.voucherNumber || '',
        vehicleNumber: (entry.vehicleNumber || '').trim(),
        amount: amount ?? 0,
        liters: liters ?? 0,
        note: entry.note || '',
      };
    });
    const khataTotal = normalizedEntries.reduce((sum, entry) => sum + entry.amount, 0);

    const expectedCash = netAmount - paymentsTotal - khataTotal;

    const denoms = denominations || {};
    const normalizedDenoms = {};
    let countedCash = 0;
    for (const [key, value] of Object.entries(DENOMINATIONS)) {
      const count = Math.max(0, Math.floor(toNonNegativeNumber(denoms[key])));
      normalizedDenoms[key] = count;
      countedCash += count * value;
    }

    const isHandover = Boolean(handedOverToManager);
    const cashDifference = isHandover ? countedCash - expectedCash : null;

    active.closing = reading;
    active.pricePerLiter = price;
    active.litersSold = litersSold;
    active.amount = amount;
    active.closedBy = req.user.id;
    active.closedAt = new Date();

    active.testingLiters = testLiters;
    active.testingAmount = testingAmount;
    active.netAmount = netAmount;
    active.payments = { phonePay, card, dpPay, hpPay };
    active.khataEntries = normalizedEntries;
    active.khataTotal = khataTotal;
    active.expectedCash = expectedCash;
    active.denominations = normalizedDenoms;
    active.countedCash = countedCash;
    active.cashDifference = cashDifference;
    active.handedOverToManager = isHandover;

    if (isHandover) {
      // Auto-accepted: the manager no longer has to review and click
      // "Received" for every handover — submitting it here is the accept.
      active.handoverStatus = 'received';
      active.handoverAt = new Date();
      active.managerActionAt = new Date();
      await User.findByIdAndUpdate(req.user.id, { $inc: { balance: cashDifference } });
    }

    await active.save();

    const nextReading = await Reading.create({
      nozzle: nozzle._id,
      opening: reading,
      openingSetBy: req.user.id,
      autoCarried: true,
    });

    res.json({ closed: active, nextOpening: nextReading });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
