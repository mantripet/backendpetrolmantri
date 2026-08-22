// One-off migration for the "nozzle product" change: fuelType used to live
// on Unit and every nozzle under it implicitly shared it. It now lives on
// each Nozzle instead, since a replacement machine can mix products across
// nozzles on the same unit. Run this ONCE against the existing database
// before deploying the new backend, so every existing nozzle keeps the
// product it already had (copied down from its unit).
//
// Usage: node scripts/migrate_nozzle_fueltype.js
require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  // Raw collections, not models — the Unit/Nozzle Mongoose schemas have
  // already moved on to the new shape, so reading through them would hide
  // the old `units.fuelType` field this script needs.
  const db = mongoose.connection.db;
  const units = db.collection('units');
  const nozzles = db.collection('nozzles');

  const unitDocs = await units.find({ fuelType: { $exists: true } }).toArray();
  console.log(`Found ${unitDocs.length} unit(s) with a fuelType to carry down`);

  let updated = 0;
  let skipped = 0;
  for (const unit of unitDocs) {
    const result = await nozzles.updateMany(
      { unit: unit._id, fuelType: { $exists: false } },
      { $set: { fuelType: unit.fuelType } }
    );
    updated += result.modifiedCount;
  }

  const stillMissing = await nozzles.countDocuments({ fuelType: { $exists: false } });
  skipped = stillMissing;

  console.log(`Updated ${updated} nozzle(s).`);
  if (stillMissing > 0) {
    console.warn(
      `${stillMissing} nozzle(s) still have no fuelType (their unit had none either) — set these manually.`
    );
  }

  console.log('Migration complete. You can now remove `fuelType` from the units collection if desired.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
