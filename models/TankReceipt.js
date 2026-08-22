const mongoose = require('mongoose');

// A fuel delivery received into a tank on a given date (e.g. from a tanker).
const tankReceiptSchema = new mongoose.Schema(
  {
    tank: { type: mongoose.Schema.Types.ObjectId, ref: 'Tank', required: true },
    date: { type: Date, required: true },
    quantity: { type: Number, required: true },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

tankReceiptSchema.index({ tank: 1, date: 1 });

module.exports = mongoose.model('TankReceipt', tankReceiptSchema);
