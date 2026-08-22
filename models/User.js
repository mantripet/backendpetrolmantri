const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    name: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    role: {
      type: String,
      enum: ['admin', 'manager', 'worker', 'accountant'],
      required: true,
    },
    // Running cash handover shortfall/overage for workers. Negative means
    // the worker owes this amount (deducted from salary), then reset to 0.
    balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
