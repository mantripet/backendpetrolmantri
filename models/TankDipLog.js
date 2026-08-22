const mongoose = require('mongoose');

const tankDipLogSchema = new mongoose.Schema(
  {
    tank: { type: mongoose.Schema.Types.ObjectId, ref: 'Tank', required: true },
    date: { type: Date, required: true },
    dipReading: { type: Number, required: true },
    liters: { type: Number, required: true },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

tankDipLogSchema.index({ tank: 1, date: -1 });

module.exports = mongoose.model('TankDipLog', tankDipLogSchema);
