const express = require('express');
const Reading = require('../models/Reading');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/pending-handovers', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  const readings = await Reading.find({ handoverStatus: 'pending' })
    .populate({ path: 'nozzle', populate: { path: 'unit' } })
    .populate('closedBy', 'username name')
    .sort({ handoverAt: -1 });
  res.json(readings);
});

// Full closed-reading history for admin/manager/accountant, with date
// range, worker, and sale-amount sorting filters.
router.get('/history', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const { from, to, workerId, sort } = req.query;

    const filter = { closing: { $ne: null } };
    if (workerId) filter.closedBy = workerId;
    if (from || to) {
      filter.closedAt = {};
      if (from) filter.closedAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.closedAt.$lte = end;
      }
    }

    let sortSpec = { closedAt: -1 };
    if (sort === 'highest') sortSpec = { amount: -1 };
    if (sort === 'lowest') sortSpec = { amount: 1 };

    const readings = await Reading.find(filter)
      .populate({ path: 'nozzle', populate: [{ path: 'unit' }, { path: 'fuelType' }] })
      .populate('closedBy', 'username name')
      .populate('khataEntries.customer', 'name phone')
      .sort(sortSpec);

    res.json(readings);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.put('/:id/handover', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['received', 'not_received'].includes(status)) {
      return res.status(400).json({ message: 'status must be received or not_received' });
    }

    const reading = await Reading.findById(req.params.id);
    if (!reading) return res.status(404).json({ message: 'Reading not found' });
    if (reading.handoverStatus !== 'pending') {
      return res.status(409).json({ message: 'This handover has already been actioned' });
    }

    reading.handoverStatus = status;
    reading.managerActionBy = req.user.id;
    reading.managerActionAt = new Date();
    await reading.save();

    res.json(reading);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
