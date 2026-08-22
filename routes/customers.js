const express = require('express');
const Customer = require('../models/Customer');
const Reading = require('../models/Reading');
const CustomerPayment = require('../models/CustomerPayment');
const { verifyToken, requireRole } = require('../middleware/auth');
const { categoryForFuelName } = require('../utils/fuelCategory');

const router = express.Router();

// Any authenticated role can list customers — workers need this for the
// khata/credit picker when closing out a nozzle.
router.get('/', verifyToken, async (req, res) => {
  const customers = await Customer.find().sort({ createdAt: -1 });
  res.json(customers);
});

// Khata ledger: every customer with their pending (due) amount split by
// fuel category — derived from summing khataEntries (grouped by the fuel
// category of the nozzle each entry was recorded on) minus any payments
// already collected against that customer/category.
router.get('/ledger', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const readings = await Reading.find({ 'khataEntries.0': { $exists: true } })
      .populate({ path: 'nozzle', populate: { path: 'fuelType' } })
      .lean();

    const dueByCustomer = new Map();
    for (const r of readings) {
      const category = categoryForFuelName(r.nozzle?.fuelType?.name);
      if (!category) continue;
      for (const entry of r.khataEntries) {
        const id = String(entry.customer);
        const bucket = dueByCustomer.get(id) || { petrol: 0, cng: 0, entryCount: 0, lastEntryAt: null };
        bucket[category] += entry.amount;
        bucket.entryCount += 1;
        if (!bucket.lastEntryAt || new Date(r.closedAt) > new Date(bucket.lastEntryAt)) {
          bucket.lastEntryAt = r.closedAt;
        }
        dueByCustomer.set(id, bucket);
      }
    }

    const payments = await CustomerPayment.find().lean();
    const paidByCustomer = new Map();
    for (const p of payments) {
      const id = String(p.customer);
      const bucket = paidByCustomer.get(id) || { petrol: 0, cng: 0 };
      bucket[p.category] += p.amount;
      paidByCustomer.set(id, bucket);
    }

    const customers = await Customer.find().lean();
    const ledger = customers.map((c) => {
      const due = dueByCustomer.get(String(c._id)) || { petrol: 0, cng: 0, entryCount: 0, lastEntryAt: null };
      const paid = paidByCustomer.get(String(c._id)) || { petrol: 0, cng: 0 };
      const duePetrol = due.petrol - paid.petrol;
      const dueCng = due.cng - paid.cng;
      return {
        _id: c._id,
        name: c.name,
        phone: c.phone,
        gstNumber: c.gstNumber,
        duePetrol,
        dueCng,
        totalDue: duePetrol + dueCng,
        totalReceived: paid.petrol + paid.cng,
        entryCount: due.entryCount,
        lastEntryAt: due.lastEntryAt,
      };
    });

    ledger.sort((a, b) => a.name.localeCompare(b.name));

    res.json(ledger);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Full khata + payment transaction history for a single customer.
router.get('/:id/ledger', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const readings = await Reading.find({ 'khataEntries.customer': req.params.id })
      .populate({ path: 'nozzle', populate: { path: 'fuelType' } })
      .populate('closedBy', 'username name')
      .sort({ closedAt: -1 });

    const entries = [];
    let duePetrol = 0;
    let dueCng = 0;
    for (const r of readings) {
      const category = categoryForFuelName(r.nozzle?.fuelType?.name);
      for (const e of r.khataEntries) {
        if (String(e.customer) === req.params.id) {
          entries.push({
            type: 'khata',
            amount: e.amount,
            liters: e.liters,
            category,
            voucherNumber: e.voucherNumber,
            vehicleNumber: e.vehicleNumber,
            note: e.note,
            closedAt: r.closedAt,
            closedBy: r.closedBy,
          });
          if (category === 'petrol') duePetrol += e.amount;
          if (category === 'cng') dueCng += e.amount;
        }
      }
    }

    const payments = await CustomerPayment.find({ customer: req.params.id })
      .populate('collectedBy', 'username name')
      .sort({ date: -1 });

    for (const p of payments) {
      entries.push({
        type: 'payment',
        amount: p.amount,
        category: p.category,
        closedAt: p.date,
        closedBy: p.collectedBy,
      });
      if (p.category === 'petrol') duePetrol -= p.amount;
      if (p.category === 'cng') dueCng -= p.amount;
    }

    entries.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

    const totalReceived = payments.reduce((sum, p) => sum + p.amount, 0);
    res.json({
      customer,
      entries,
      duePetrol,
      dueCng,
      totalDue: duePetrol + dueCng,
      totalReceived,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Manager/admin collects cash from a khata customer against one fuel
// category, reducing that customer's due and adding the cash into that
// category's cashbook for the day it's collected.
router.post('/:id/payments', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { amount, category, date } = req.body;
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ message: 'amount (positive number) is required' });
    }
    if (!['petrol', 'cng'].includes(category)) {
      return res.status(400).json({ message: 'category must be petrol or cng' });
    }

    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const payment = await CustomerPayment.create({
      customer: customer._id,
      category,
      amount,
      date: date ? new Date(date) : new Date(),
      collectedBy: req.user.id,
    });

    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, phone, gstNumber } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    const customer = await Customer.create({
      name,
      phone,
      gstNumber: gstNumber || '',
      createdBy: req.user.id,
    });

    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
