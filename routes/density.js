const express = require('express');
const Tank = require('../models/Tank');
const FuelDensityLog = require('../models/FuelDensityLog');
const { verifyToken, requireRole } = require('../middleware/auth');
const { dipToLiters, monthYearRange } = require('../utils/dip');
const { densityAt15 } = require('../utils/density');

const router = express.Router();

// Live preview for the entry form: lets the client show density-at-15°C as
// the user types, without duplicating the correction formula client-side
// (a duplicated copy previously drifted out of sync with this one).
router.post('/preview', verifyToken, requireRole('admin', 'manager'), (req, res) => {
  const { density, temperature } = req.body;
  if (typeof density !== 'number' || typeof temperature !== 'number') {
    return res.status(400).json({ message: 'density and temperature must be numbers' });
  }
  res.json({ density15: densityAt15(density, temperature) });
});

// Upserts by (tank, calendar day): a morning-density entry and a same-day
// receipt entry merge into one row instead of leaving two half-filled rows,
// matching the paper register's one-row-per-day layout. Only fields present
// in the request body are touched — an existing value survives a request
// that doesn't mention it.
router.post('/:tankId/entry', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const {
      date,
      morningDensity,
      morningTemp,
      compartment1,
      compartment2,
      compartment3,
      compartment4,
      challanDensity15,
      dipBeforeReceipt,
      afterDecantDensity15,
      receiptKL,
      challanNo,
    } = req.body;

    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }

    const tank = await Tank.findById(req.params.tankId);
    if (!tank) return res.status(404).json({ message: 'Tank not found' });

    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    let entry = await FuelDensityLog.findOne({ tank: tank._id, date: { $gte: day, $lt: nextDay } });
    if (!entry) {
      entry = new FuelDensityLog({ tank: tank._id, date: day });
    }

    if (morningDensity !== undefined) entry.morningDensity = morningDensity;
    if (morningTemp !== undefined) entry.morningTemp = morningTemp;
    if (compartment1 !== undefined) entry.compartment1 = compartment1;
    if (compartment2 !== undefined) entry.compartment2 = compartment2;
    if (compartment3 !== undefined) entry.compartment3 = compartment3;
    if (compartment4 !== undefined) entry.compartment4 = compartment4;
    if (challanDensity15 !== undefined) entry.challanDensity15 = challanDensity15;
    if (dipBeforeReceipt !== undefined) entry.dipBeforeReceipt = dipBeforeReceipt;
    if (afterDecantDensity15 !== undefined) entry.afterDecantDensity15 = afterDecantDensity15;
    if (receiptKL !== undefined) entry.receiptKL = receiptKL;
    if (challanNo !== undefined) entry.challanNo = challanNo;
    entry.enteredBy = req.user.id;

    entry.morningDensity15 =
      typeof entry.morningDensity === 'number' && typeof entry.morningTemp === 'number'
        ? densityAt15(entry.morningDensity, entry.morningTemp)
        : null;

    const compartments = [
      entry.compartment1,
      entry.compartment2,
      entry.compartment3,
      entry.compartment4,
    ].filter((v) => typeof v === 'number');
    entry.mixDensity =
      compartments.length > 0
        ? compartments.reduce((sum, v) => sum + v, 0) / compartments.length
        : null;

    entry.diffMixChallan =
      entry.mixDensity != null && typeof entry.challanDensity15 === 'number'
        ? entry.mixDensity - entry.challanDensity15
        : null;

    entry.stockBeforeReceipt =
      typeof entry.dipBeforeReceipt === 'number' && tank.grid.length > 0
        ? dipToLiters(tank.grid, entry.dipBeforeReceipt)
        : null;

    await entry.save();
    res.status(200).json(entry);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Optional ?month=1-12&year=YYYY narrows results to that calendar month.
router.get(
  '/:tankId/entries',
  verifyToken,
  requireRole('admin', 'manager', 'accountant'),
  async (req, res) => {
  const filter = { tank: req.params.tankId };
  const range = monthYearRange(req.query);
  if (range) filter.date = range;

  const entries = await FuelDensityLog.find(filter)
    .populate('enteredBy', 'username name')
    .sort({ date: 1 });
  res.json(entries);
});

module.exports = router;
