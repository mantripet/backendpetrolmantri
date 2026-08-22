const mongoose = require('mongoose');

// One day's Temperature/Density record for a tank, matching the paper
// register: morning U/G tank density, truck-receipt compartment densities
// (on delivery days), stock before receipt, and post-decantation check.
const fuelDensityLogSchema = new mongoose.Schema(
  {
    tank: { type: mongoose.Schema.Types.ObjectId, ref: 'Tank', required: true },
    date: { type: Date, required: true },

    // Morning density at U/G tank — manager enters density + temp, 15°C value is auto-calculated.
    morningDensity: { type: Number, default: null },
    morningTemp: { type: Number, default: null },
    morningDensity15: { type: Number, default: null },

    // Truck/tank receipt compartment densities — only filled on delivery days.
    compartment1: { type: Number, default: null },
    compartment2: { type: Number, default: null },
    compartment3: { type: Number, default: null },
    compartment4: { type: Number, default: null },
    mixDensity: { type: Number, default: null }, // auto = average of entered compartments

    challanDensity15: { type: Number, default: null }, // manual, from supplier's challan
    diffMixChallan: { type: Number, default: null }, // auto = mixDensity - challanDensity15

    dipBeforeReceipt: { type: Number, default: null }, // manual
    stockBeforeReceipt: { type: Number, default: null }, // auto, via tank's dip chart

    afterDecantDensity15: { type: Number, default: null }, // manual
    receiptKL: { type: Number, default: null }, // manual, delivered quantity in kilolitres
    challanNo: { type: String, trim: true, default: '' }, // manual

    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

fuelDensityLogSchema.index({ tank: 1, date: 1 });

module.exports = mongoose.model('FuelDensityLog', fuelDensityLogSchema);
