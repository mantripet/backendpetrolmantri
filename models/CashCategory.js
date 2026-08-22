const mongoose = require('mongoose');

// Tracks the station-wide cashbook opening balance for a fuel category.
// 'petrol' covers HSD+MS+MSP combined; 'cng' is separate.
const cashCategorySchema = new mongoose.Schema(
  {
    category: { type: String, enum: ['petrol', 'cng'], required: true, unique: true },
    openingBalance: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CashCategory', cashCategorySchema);
