// Sets up an isolated in-memory MongoDB so these tests never touch the real
// Atlas cluster configured in backend/.env. Must run before `require('../index')`
// so dotenv (loaded inside index.js) doesn't get a chance to set MONGODB_URI —
// dotenv never overwrites variables that are already present in process.env.
process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');

let mongod;
let app;

let User, FuelType, Unit, Nozzle, Customer, Reading;

function tokenFor(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();

  // Connect mongoose's default connection ourselves: test setup below calls
  // models directly (bypassing the app's HTTP routes), so it can't rely on
  // index.js's request-triggered lazy connectDB() to have run yet.
  await mongoose.connect(process.env.MONGODB_URI);

  app = require('../index');

  User = require('../models/User');
  FuelType = require('../models/FuelType');
  Unit = require('../models/Unit');
  Nozzle = require('../models/Nozzle');
  Customer = require('../models/Customer');
  Reading = require('../models/Reading');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

/** Seeds a fuel type + unit + nozzle + an open (unclosed) reading, a worker,
 * a manager, and a khata customer. Returns everything a closing test needs. */
async function seedNozzleAndActors({ price = 100, opening = 1000 } = {}) {
  const fuelType = await FuelType.create({ name: 'MS', price });
  const unit = await Unit.create({ name: 'Unit 1' });
  const nozzle = await Nozzle.create({ name: 'Nozzle 1', unit: unit._id, fuelType: fuelType._id });

  const worker = await User.create({
    username: 'worker1',
    password: 'hashed-irrelevant-for-tests',
    role: 'worker',
  });
  const manager = await User.create({
    username: 'manager1',
    password: 'hashed-irrelevant-for-tests',
    role: 'manager',
  });
  const customer = await Customer.create({
    name: 'Test Customer',
    phone: '9999999999',
    createdBy: manager._id,
  });

  const activeReading = await Reading.create({
    nozzle: nozzle._id,
    opening,
    openingSetBy: manager._id,
  });

  return { fuelType, unit, nozzle, worker, manager, customer, activeReading };
}

describe('POST /api/nozzles/:id/closing — role permission', () => {
  test('a worker submitting their own shift close is allowed (not "Insufficient permissions")', async () => {
    const { nozzle, worker } = await seedNozzleAndActors();

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ reading: 1010, testingLiters: 0, payments: {}, khataEntries: [], denominations: {} });

    expect(res.status).toBe(200);
    expect(res.body.closed.litersSold).toBe(10);
  });

  test('a manager (not a worker) is rejected with "Insufficient permissions", proving the role gate is scoped to workers', async () => {
    const { nozzle, manager } = await seedNozzleAndActors();

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reading: 1010, testingLiters: 0, payments: {}, khataEntries: [], denominations: {} });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Insufficient permissions');
  });

  test('no token at all is rejected with 401, not the permissions message', async () => {
    const { nozzle } = await seedNozzleAndActors();

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .send({ reading: 1010 });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/nozzles/:id/closing — khata entry: vehicle number + amount/liters auto-calc', () => {
  test('amount-only entry auto-computes liters from the nozzle price, and vehicle number is saved', async () => {
    const { nozzle, worker, customer } = await seedNozzleAndActors({ price: 100 });

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [
          { customer: customer._id, amount: 500, vehicleNumber: 'mh12ab1234', voucherNumber: 'V1' },
        ],
        denominations: {},
      });

    expect(res.status).toBe(200);
    const entry = res.body.closed.khataEntries[0];
    expect(entry.amount).toBe(500);
    expect(entry.liters).toBe(5); // 500 / 100 price-per-liter
    expect(entry.vehicleNumber).toBe('MH12AB1234'); // schema uppercases it
  });

  test('liters-only entry auto-computes the amount from the nozzle price', async () => {
    const { nozzle, worker, customer } = await seedNozzleAndActors({ price: 100 });

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [{ customer: customer._id, liters: 5 }],
        denominations: {},
      });

    expect(res.status).toBe(200);
    const entry = res.body.closed.khataEntries[0];
    expect(entry.liters).toBe(5);
    expect(entry.amount).toBe(500); // 5 * 100 price-per-liter
  });

  test('a khata entry with neither amount nor liters is rejected with a clear 400, not silently saved as ₹0', async () => {
    const { nozzle, worker, customer } = await seedNozzleAndActors({ price: 100 });

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [{ customer: customer._id }],
        denominations: {},
      });

    expect(res.status).toBe(400);
  });

  test('a khata entry missing a customer is rejected with a clear 400', async () => {
    const { nozzle, worker } = await seedNozzleAndActors({ price: 100 });

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [{ amount: 500 }],
        denominations: {},
      });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/nozzles/:id/closing — cash handover auto-accept', () => {
  test('a handed-over closing is auto-accepted (handoverStatus "received"), never left "pending" for a manager to action', async () => {
    const { nozzle, worker } = await seedNozzleAndActors({ price: 100 });

    // 100 liters sold @ 100 = 10000 net. Hand over exactly that much cash.
    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [],
        denominations: { n500: 20 }, // 20 * 500 = 10000
        handedOverToManager: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.closed.handoverStatus).toBe('received');
    expect(res.body.closed.handoverAt).toBeTruthy();
    expect(res.body.closed.cashDifference).toBe(0);
  });

  test('an auto-accepted handover never shows up in the manager\'s pending-handovers queue', async () => {
    const { nozzle, worker, manager } = await seedNozzleAndActors({ price: 100 });

    await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [],
        denominations: { n500: 20 },
        handedOverToManager: true,
      });

    const res = await request(app)
      .get('/api/readings/pending-handovers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('a worker\'s balance still reflects the cash difference immediately on auto-accept', async () => {
    const { nozzle, worker } = await seedNozzleAndActors({ price: 100 });

    // Expected cash 10000, but only 9500 counted -> worker short by 500.
    await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [],
        denominations: { n500: 19 }, // 19 * 500 = 9500
        handedOverToManager: true,
      });

    const updatedWorker = await User.findById(worker._id);
    expect(updatedWorker.balance).toBe(-500);
  });

  test('not handing over leaves handoverStatus at the default "none" (no manager action implied either way)', async () => {
    const { nozzle, worker } = await seedNozzleAndActors({ price: 100 });

    const res = await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [],
        denominations: {},
        handedOverToManager: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.closed.handoverStatus).toBe('none');
  });
});

describe('GET /api/customers/:id/ledger — vehicle number and liters pass through to reports', () => {
  test('a manager viewing a customer\'s ledger sees the vehicle number and liters recorded at the nozzle', async () => {
    const { nozzle, worker, manager, customer } = await seedNozzleAndActors({ price: 100 });

    await request(app)
      .post(`/api/nozzles/${nozzle._id}/closing`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        reading: 1100,
        testingLiters: 0,
        payments: {},
        khataEntries: [
          { customer: customer._id, amount: 300, vehicleNumber: 'ka01xy9999' },
        ],
        denominations: {},
      });

    const res = await request(app)
      .get(`/api/customers/${customer._id}/ledger`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    const khataEntry = res.body.entries.find((e) => e.type === 'khata');
    expect(khataEntry.vehicleNumber).toBe('KA01XY9999');
    expect(khataEntry.liters).toBe(3);
    expect(khataEntry.amount).toBe(300);
  });
});
