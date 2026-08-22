const express = require('express');
const FuelType = require('../models/FuelType');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  const fuelTypes = await FuelType.find().sort({ name: 1 });
  res.json(fuelTypes);
});

router.put('/:name', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { price } = req.body;
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ message: 'price must be a non-negative number' });
    }

    const fuelType = await FuelType.findOneAndUpdate(
      { name: req.params.name.toUpperCase() },
      { price, updatedBy: req.user.id },
      { returnDocument: 'after' }
    );

    if (!fuelType) {
      return res.status(404).json({ message: 'Fuel type not found' });
    }

    res.json(fuelType);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
