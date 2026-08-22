const mongoose = require('mongoose');

// A Unit is just the dispensing machine's identity (e.g. "DU-1"). It does not
// carry a fuel type itself — each of its nozzles picks its own product, since
// a replacement machine from the company can mix high/low-speed nozzles
// across different fuels on the same unit. See Nozzle.fuelType.
const unitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Unit', unitSchema);
