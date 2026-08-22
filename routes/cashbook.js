const express = require('express');
const CashCategory = require('../models/CashCategory');
const BankDeposit = require('../models/BankDeposit');
const CustomerPayment = require('../models/CustomerPayment');
const FuelType = require('../models/FuelType');
const Nozzle = require('../models/Nozzle');
const Reading = require('../models/Reading');
const { verifyToken, requireRole } = require('../middleware/auth');
const { CATEGORY_FUEL_TYPES } = require('../utils/fuelCategory');

const router = express.Router();

function isValidCategory(category) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_FUEL_TYPES, category);
}

async function nozzleIdsForCategory(category) {
  const fuelTypes = await FuelType.find({ name: { $in: CATEGORY_FUEL_TYPES[category] } });
  const nozzles = await Nozzle.find({ fuelType: { $in: fuelTypes.map((f) => f._id) } });
  return nozzles.map((n) => n._id);
}

router.get('/:category', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  const { category } = req.params;
  if (!isValidCategory(category)) {
    return res.status(400).json({ message: 'category must be petrol or cng' });
  }

  const cashCategory = await CashCategory.findOne({ category });
  const openingBalance = cashCategory ? cashCategory.openingBalance : 0;

  const nozzleIds = await nozzleIdsForCategory(category);
  const readings = await Reading.find({ nozzle: { $in: nozzleIds }, closing: { $ne: null } });

  let cashFromSales = 0;
  let totalCard = 0;
  let totalPhonePay = 0;
  let totalDpPay = 0;
  let totalHpPay = 0;
  let totalKhata = 0;
  for (const r of readings) {
    cashFromSales += r.expectedCash || 0;
    totalCard += r.payments?.card || 0;
    totalPhonePay += r.payments?.phonePay || 0;
    totalDpPay += r.payments?.dpPay || 0;
    totalHpPay += r.payments?.hpPay || 0;
    totalKhata += r.khataTotal || 0;
  }

  const deposits = await BankDeposit.find({ category });
  const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);

  const vendorPayments = await CustomerPayment.find({ category });
  const totalVendorCollections = vendorPayments.reduce((sum, p) => sum + p.amount, 0);

  const currentBalance = openingBalance + cashFromSales + totalVendorCollections - totalDeposits;

  res.json({
    category,
    openingBalance,
    cashFromSales,
    totalDeposits,
    totalVendorCollections,
    currentBalance,
    breakdown: {
      card: totalCard,
      phonePay: totalPhonePay,
      dpPay: totalDpPay,
      hpPay: totalHpPay,
      khata: totalKhata,
    },
  });
});

// Admin sets/edits the starting cash balance for this category.
router.put(
  '/:category/opening-balance',
  verifyToken,
  requireRole('admin'),
  async (req, res) => {
    const { category } = req.params;
    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'category must be petrol or cng' });
    }
    const { openingBalance } = req.body;
    if (typeof openingBalance !== 'number') {
      return res.status(400).json({ message: 'openingBalance must be a number' });
    }

    const doc = await CashCategory.findOneAndUpdate(
      { category },
      { openingBalance, updatedBy: req.user.id },
      { upsert: true, returnDocument: 'after' }
    );

    res.json(doc);
  }
);

// Manager records cash deposited to the bank; reduces the cashbook balance.
router.post('/:category/deposit', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { category } = req.params;
    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'category must be petrol or cng' });
    }
    const { amount, date } = req.body;
    if (typeof amount !== 'number' || amount <= 0 || !date) {
      return res.status(400).json({ message: 'amount (positive number) and date are required' });
    }

    const deposit = await BankDeposit.create({
      category,
      amount,
      date: new Date(date),
      enteredBy: req.user.id,
    });

    res.status(201).json(deposit);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Builds a { $gte, $lte } date filter from optional ?from&to ISO dates.
function dayRange(query) {
  const { from, to } = query;
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
}

// Optional ?from&to ISO dates narrow results to that day range.
router.get(
  '/:category/deposits',
  verifyToken,
  requireRole('admin', 'manager', 'accountant'),
  async (req, res) => {
    const { category } = req.params;
    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'category must be petrol or cng' });
    }

    const filter = { category };
    const range = dayRange(req.query);
    if (range) filter.date = range;

    const deposits = await BankDeposit.find(filter)
      .populate('enteredBy', 'username name')
      .sort({ date: -1 });
    res.json(deposits);
  }
);

// Optional ?from&to ISO dates narrow results to that day range.
router.get(
  '/:category/vendor-collections',
  verifyToken,
  requireRole('admin', 'manager', 'accountant'),
  async (req, res) => {
    const { category } = req.params;
    if (!isValidCategory(category)) {
      return res.status(400).json({ message: 'category must be petrol or cng' });
    }

    const filter = { category };
    const range = dayRange(req.query);
    if (range) filter.date = range;

    const collections = await CustomerPayment.find(filter)
      .populate('customer', 'name phone')
      .populate('collectedBy', 'username name')
      .sort({ date: -1 });
    res.json(collections);
  }
);

module.exports = router;
