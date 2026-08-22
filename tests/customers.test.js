// Isolated in-memory MongoDB, same pattern as nozzleClosing.test.js — never
// touches the real Atlas cluster from backend/.env.
process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');

let mongod;
let app;
let User, Customer;

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
  Customer = require('../models/Customer');
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

describe('POST /api/customers — GST number replaces address/note', () => {
  test('admin can create a khata customer with just name, phone, and GST number', async () => {
    const admin = await User.create({ username: 'admin1', password: 'x', role: 'admin' });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ name: 'Test Vendor', phone: '9998887777', gstNumber: '29abcde1234f1z5' });

    expect(res.status).toBe(201);
    expect(res.body.gstNumber).toBe('29ABCDE1234F1Z5'); // schema uppercases it
    expect(res.body.address).toBeUndefined();
    expect(res.body.note).toBeUndefined();
  });

  test('GST number is optional — a customer can still be created without one', async () => {
    const admin = await User.create({ username: 'admin2', password: 'x', role: 'admin' });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ name: 'No GST Vendor', phone: '9998887778' });

    expect(res.status).toBe(201);
    expect(res.body.gstNumber).toBe('');
  });

  test('name and phone are still required', async () => {
    const admin = await User.create({ username: 'admin3', password: 'x', role: 'admin' });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ gstNumber: '29ABCDE1234F1Z5' });

    expect(res.status).toBe(400);
  });

  test('a non-admin (e.g. manager) cannot create a khata customer', async () => {
    const manager = await User.create({ username: 'manager2', password: 'x', role: 'manager' });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ name: 'Test Vendor', phone: '9998887777' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/customers/ledger — GST number surfaces instead of address/note', () => {
  test('the ledger list includes gstNumber for each customer', async () => {
    const admin = await User.create({ username: 'admin4', password: 'x', role: 'admin' });
    await Customer.create({
      name: 'Ledger Vendor',
      phone: '9998887779',
      gstNumber: '29ABCDE1234F1Z5',
      createdBy: admin._id,
    });

    const res = await request(app)
      .get('/api/customers/ledger')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body[0].gstNumber).toBe('29ABCDE1234F1Z5');
  });
});
