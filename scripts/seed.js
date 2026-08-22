require('dotenv').config();
const mongoose = require('mongoose');
const FuelType = require('../models/FuelType');

// Dispensing units and their nozzles are no longer seeded here — the admin
// creates them from the app's Check Reading screen (unit name, then each
// nozzle's name + product), since real hardware layouts vary per station and
// change whenever the company swaps in a new machine. This script only makes
// sure the base product catalog exists so the admin has something to price
// and to pick from when adding a nozzle.
async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  for (const name of ['HSD', 'MS', 'MSP', 'CNG']) {
    await FuelType.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, price: 0 } },
      { upsert: true, returnDocument: 'after' }
    );
  }

  console.log('Fuel types ready (HSD, MS, MSP, CNG)');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
