const mongoose = require('mongoose');

// Cash the manager collects from a khata customer, reducing that
// customer's pending due and feeding into the cashbook's cash-in-hand for
// the fuel category (petrol/cng) the underlying khata entries belong to.
const customerPaymentSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    category: { type: String, enum: ['petrol', 'cng'], required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

customerPaymentSchema.index({ customer: 1, date: -1 });
customerPaymentSchema.index({ category: 1, date: -1 });

module.exports = mongoose.model('CustomerPayment', customerPaymentSchema);
