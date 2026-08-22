const mongoose = require('mongoose');

const khataEntrySchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    voucherNumber: { type: String, trim: true, default: '' },
    vehicleNumber: { type: String, trim: true, uppercase: true, default: '' },
    amount: { type: Number, required: true },
    // Liters this khata entry represents. Whichever of amount/liters the
    // worker didn't type in is derived from the nozzle's price per liter —
    // see the normalization in nozzles.js's closing route.
    liters: { type: Number, default: 0 },
    note: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

// A Reading represents one meter cycle for a nozzle: opened with a starting
// meter value, later closed with an ending value. While `closing` is null,
// this is the nozzle's active/current reading. Closing it computes the sale
// and automatically opens the next cycle with opening = this closing value.
const readingSchema = new mongoose.Schema(
  {
    nozzle: { type: mongoose.Schema.Types.ObjectId, ref: 'Nozzle', required: true },
    opening: { type: Number, required: true },
    closing: { type: Number, default: null },
    openingSetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    autoCarried: { type: Boolean, default: false },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pricePerLiter: { type: Number, default: null },
    litersSold: { type: Number, default: null },
    amount: { type: Number, default: null },
    closedAt: { type: Date, default: null },

    // Fuel used for nozzle testing, deducted from the sale amount.
    testingLiters: { type: Number, default: 0 },
    testingAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: null },

    // Digital payment breakdown collected for this shift's sale.
    payments: {
      phonePay: { type: Number, default: 0 },
      card: { type: Number, default: 0 },
      dpPay: { type: Number, default: 0 },
      hpPay: { type: Number, default: 0 },
    },

    khataEntries: { type: [khataEntrySchema], default: [] },
    khataTotal: { type: Number, default: 0 },

    // netAmount - all payments - khataTotal = cash the worker should be holding.
    expectedCash: { type: Number, default: null },

    // Physical cash counted by the worker, by denomination — matches the
    // notes nozzle boys actually hand over: ₹10, ₹20, ₹50, ₹100, ₹200, ₹500.
    denominations: {
      n500: { type: Number, default: 0 },
      n200: { type: Number, default: 0 },
      n100: { type: Number, default: 0 },
      n50: { type: Number, default: 0 },
      n20: { type: Number, default: 0 },
      n10: { type: Number, default: 0 },
    },
    countedCash: { type: Number, default: null },
    // countedCash - expectedCash. Negative means the worker is short.
    cashDifference: { type: Number, default: null },

    handedOverToManager: { type: Boolean, default: false },
    handoverStatus: {
      type: String,
      enum: ['none', 'pending', 'received', 'not_received'],
      default: 'none',
    },
    handoverAt: { type: Date, default: null },
    managerActionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    managerActionAt: { type: Date, default: null },
  },
  { timestamps: true }
);

readingSchema.index({ nozzle: 1, closing: 1 });
readingSchema.index({ handoverStatus: 1 });

module.exports = mongoose.model('Reading', readingSchema);
