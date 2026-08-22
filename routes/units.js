const express = require('express');
const Unit = require('../models/Unit');
const Nozzle = require('../models/Nozzle');
const Reading = require('../models/Reading');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Units with their nozzles (each nozzle carries its own product/fuel type)
// and each nozzle's active (unclosed) reading.
router.get('/', verifyToken, async (req, res) => {
  const units = await Unit.find().sort({ name: 1 });

  const nozzles = await Nozzle.find().populate('fuelType').sort({ name: 1 });

  const activeReadings = await Reading.find({ closing: null });
  const activeByNozzle = new Map(activeReadings.map((r) => [String(r.nozzle), r]));

  const nozzlesByUnit = new Map();
  for (const nozzle of nozzles) {
    const list = nozzlesByUnit.get(String(nozzle.unit)) || [];
    list.push({
      id: nozzle._id,
      name: nozzle.name,
      fuelType: nozzle.fuelType,
      activeReading: activeByNozzle.get(String(nozzle._id)) || null,
    });
    nozzlesByUnit.set(String(nozzle.unit), list);
  }

  const result = units.map((unit) => ({
    id: unit._id,
    name: unit.name,
    nozzles: nozzlesByUnit.get(String(unit._id)) || [],
  }));

  res.json(result);
});

// Admin creates a new dispensing unit by name. Nozzles (and their products)
// are added separately via POST /api/nozzles.
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name is required' });

    const existing = await Unit.findOne({ name });
    if (existing) return res.status(409).json({ message: 'A unit with this name already exists' });

    const unit = await Unit.create({ name });
    res.status(201).json(unit);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin renames a dispensing unit.
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name is required' });

    const existing = await Unit.findOne({ name, _id: { $ne: req.params.id } });
    if (existing) return res.status(409).json({ message: 'A unit with this name already exists' });

    const unit = await Unit.findByIdAndUpdate(req.params.id, { name }, { returnDocument: 'after' });
    if (!unit) return res.status(404).json({ message: 'Unit not found' });

    res.json(unit);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin removes a dispensing unit — only once its nozzles have been removed
// first, so a unit with reading history can never be dropped by accident.
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const nozzleCount = await Nozzle.countDocuments({ unit: req.params.id });
    if (nozzleCount > 0) {
      return res
        .status(409)
        .json({ message: 'Remove this unit\'s nozzles first before deleting the unit' });
    }

    const unit = await Unit.findByIdAndDelete(req.params.id);
    if (!unit) return res.status(404).json({ message: 'Unit not found' });

    res.json({ message: 'Unit deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
