const mongoose = require('mongoose');

const fuelTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: ['HSD', 'MS', 'MSP', 'CNG'],
      required: true,
      unique: true,
    },
    price: { type: Number, required: true, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FuelType', fuelTypeSchema);
