require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Tank = require('../models/Tank');
const FuelType = require('../models/FuelType');

const SCRATCHPAD =
  'C:\\Users\\ADILAM~1\\AppData\\Local\\Temp\\claude\\c--Users-Adil-Ameer-Desktop-pump\\da40da6e-696d-4101-b9aa-8d3c091a08fc\\scratchpad';

// Each CSV's total volume (last row) uniquely matches an existing tank.
const IMPORTS = [
  { file: 'petrol_dip_chart.csv', tankName: 'MS', fuelTypeName: 'MS' },
  { file: 'power_petrol_dip_chart.csv', tankName: 'MSP', fuelTypeName: 'MSP' },
  { file: 'diesel_dip_chart.csv', tankName: 'HSD', fuelTypeName: 'HSD' },
];

function csvToGrid(csvText) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const dataLines = lines[0].toLowerCase().startsWith('dip') ? lines.slice(1) : lines;

  const byDip = new Map();
  let maxDip = 0;
  for (const line of dataLines) {
    const [dipStr, volStr] = line.split(',');
    const dip = Number(dipStr);
    const vol = Number(volStr);
    byDip.set(dip, vol);
    if (dip > maxDip) maxDip = dip;
  }

  const rowCount = Math.floor(maxDip / 10) + 1;
  const grid = [];
  let lastKnown = 0;
  for (let row = 0; row < rowCount; row++) {
    const rowValues = [];
    for (let col = 0; col < 10; col++) {
      const dip = row * 10 + col;
      if (byDip.has(dip)) {
        lastKnown = byDip.get(dip);
        rowValues.push(lastKnown);
      } else {
        // Beyond the chart's max recorded dip (tank is already full) — pad
        // with the last known value so the grid stays rectangular.
        rowValues.push(lastKnown);
      }
    }
    grid.push(rowValues);
  }
  return { grid, maxDip, maxVolume: byDip.get(maxDip) };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  for (const { file, tankName, fuelTypeName } of IMPORTS) {
    const csvText = fs.readFileSync(path.join(SCRATCHPAD, file), 'utf8');
    const { grid, maxDip, maxVolume } = csvToGrid(csvText);

    const fuelType = await FuelType.findOne({ name: fuelTypeName });
    if (!fuelType) {
      console.error(`FuelType ${fuelTypeName} not found, skipping ${file}`);
      continue;
    }

    const tank = await Tank.findOne({ totalVolume: maxVolume });
    if (!tank) {
      console.error(`No tank found with totalVolume ${maxVolume} for ${file}, skipping`);
      continue;
    }

    tank.name = tankName;
    tank.fuelType = fuelType._id;
    tank.grid = grid;
    await tank.save();

    console.log(
      `Imported ${file} -> tank "${tankName}" (${tank._id}): ${grid.length} rows, max dip ${maxDip}, max volume ${maxVolume}`
    );
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
