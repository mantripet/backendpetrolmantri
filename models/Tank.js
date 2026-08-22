const mongoose = require('mongoose');

// grid[row][col] = liters at dip = row*10 + col (matches the printed dip
// chart layout: row is the tens digit, col is the ones digit).
const tankSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    totalVolume: { type: Number, required: true },
    fuelType: { type: mongoose.Schema.Types.ObjectId, ref: 'FuelType', default: null },
    grid: { type: [[Number]], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tank', tankSchema);
