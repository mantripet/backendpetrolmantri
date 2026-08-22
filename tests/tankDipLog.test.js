// Isolated in-memory MongoDB, same pattern as the other test files — never
// touches the real Atlas cluster from backend/.env.
process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');

let mongod;
let app;
let User, Tank;

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
  await mongoose.connect(process.env.MONGODB_URI);

  app = require('../index');
  User = require('../models/User');
  Tank = require('../models/Tank');
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

async function seedManagerAndTank() {
  const manager = await User.create({ username: 'manager1', password: 'x', role: 'manager' });
  const tank = await Tank.create({
    name: 'Tank 1',
    totalVolume: 10000,
    grid: [[100, 150]], // dip 0 -> 100L, dip 1 -> 150L
  });
  return { manager, tank };
}

describe('POST /api/tanks/:id/dip-log — one dip reading per calendar date', () => {
  test('the first dip reading for a tank on a date is saved successfully', async () => {
    const { manager, tank } = await seedManagerAndTank();

    const res = await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 0 });

    expect(res.status).toBe(201);
    expect(res.body.liters).toBe(100);
  });

  test('a second dip reading for the same tank on the same date is rejected with 409', async () => {
    const { manager, tank } = await seedManagerAndTank();

    await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 0 });

    const res = await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 1 });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cannot add twice on same date/i);
  });

  test('same date but a different time-of-day is still treated as a duplicate', async () => {
    const { manager, tank } = await seedManagerAndTank();

    await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T09:15:00.000', dipReading: 0 });

    // Later the same calendar day, e.g. an evening re-check.
    const res = await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T21:45:00.000', dipReading: 1 });

    expect(res.status).toBe(409);
  });

  test('a dip reading for a different date on the same tank is allowed', async () => {
    const { manager, tank } = await seedManagerAndTank();

    await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 0 });

    const res = await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-22T00:00:00.000', dipReading: 1 });

    expect(res.status).toBe(201);
  });

  test('the same date is allowed across two different tanks', async () => {
    const { manager, tank } = await seedManagerAndTank();
    const tank2 = await Tank.create({ name: 'Tank 2', totalVolume: 8000, grid: [[100, 150]] });

    await request(app)
      .post(`/api/tanks/${tank._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 0 });

    const res = await request(app)
      .post(`/api/tanks/${tank2._id}/dip-log`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ date: '2026-08-21T00:00:00.000', dipReading: 0 });

    expect(res.status).toBe(201);
  });
});
