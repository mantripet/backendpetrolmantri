const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Manager/accountant also need this list to filter payment history by worker name.
router.get('/', verifyToken, requireRole('admin', 'manager', 'accountant'), async (req, res) => {
  const users = await User.find({ role: { $in: ['manager', 'worker', 'accountant'] } })
    .select('-password')
    .sort({ createdAt: -1 });
  res.json(users);
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'Username, password and role are required' });
    }
    if (!['manager', 'worker', 'accountant'].includes(role)) {
      return res.status(400).json({ message: 'Role must be manager, worker or accountant' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      name: name || '',
      email: email || '',
      role,
    });

    const sanitized = user.toObject();
    delete sanitized.password;

    res.status(201).json(sanitized);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Admin or manager can zero out a worker's cash-handover balance, typically
// after the shortfall has been deducted from their salary.
router.put('/:id/reset-balance', verifyToken, requireRole('admin', 'manager'), async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { balance: 0 },
    { returnDocument: 'after' }
  ).select('-password');

  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

module.exports = router;
