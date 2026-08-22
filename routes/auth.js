const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/me', verifyToken, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

// Self-service profile update: username/name/email, and optionally a
// password change (requires the current password). Scoped to the
// authenticated user's own account — role is never editable here.
router.put('/me', verifyToken, async (req, res) => {
  try {
    const { username, name, email, currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed) return res.status(400).json({ message: 'Username cannot be empty' });
      if (trimmed !== user.username) {
        const existing = await User.findOne({ username: trimmed });
        if (existing) return res.status(409).json({ message: 'Username already taken' });
        user.username = trimmed;
      }
    }
    if (name !== undefined) user.name = name.trim();
    if (email !== undefined) user.email = email.trim();

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to set a new password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters' });
      }
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    const sanitized = await User.findById(user._id).select('-password');
    res.json(sanitized);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'Username, password and role are required' });
    }
    if (!['admin', 'manager', 'worker', 'accountant'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin, manager, worker or accountant' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword, role });

    res.status(201).json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
