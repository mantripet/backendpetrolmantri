const mongoose = require('mongoose');

// Cash the manager deposited to the bank, reducing the cashbook balance
// for that fuel category.
const bankDepositSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ['petrol', 'cng'], required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

bankDepositSchema.index({ category: 1, date: -1 });

module.exports = mongoose.model('BankDeposit', bankDepositSchema);
