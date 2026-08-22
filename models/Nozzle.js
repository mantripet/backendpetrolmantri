const mongoose = require('mongoose');

const nozzleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    // The product this nozzle dispenses. Configured per-nozzle (not per-unit)
    // because a single dispensing unit can mix nozzles across fuels.
    fuelType: { type: mongoose.Schema.Types.ObjectId, ref: 'FuelType', required: true },
  },
  { timestamps: true }
);

nozzleSchema.index({ unit: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Nozzle', nozzleSchema);
