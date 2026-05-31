const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

// Generate token
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ─── POST: Login ──────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    res.json({
      token: generateToken(user._id),
      user: {
        id:          user._id,
        fullName:    user.fullName,
        username:    user.username,
        role:        user.role,
        terminal:    user.terminal,
        permissions: user.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Get current logged in user ─────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({
    id:          req.user._id,
    fullName:    req.user.fullName,
    username:    req.user.username,
    role:        req.user.role,
    terminal:    req.user.terminal,
    permissions: req.user.permissions
  });
});

// ─── GET: Get all users (admin only) ─────────────────────────────────────────
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST: Create a new user (admin only) ────────────────────────────────────
router.post('/users', protect, adminOnly, async (req, res) => {
  try {
    const { fullName, username, password, role, terminal, permissions } = req.body;

    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) {
      return res.status(400).json({ error: 'Username already exists.' });
    }

    const user = await User.create({
      fullName,
      username,
      password,
      role:        role        || 'user',
      terminal:    terminal    || 'All Terminals',
      permissions: permissions || { canAdd: false, canDelete: false }
    });

    res.status(201).json({
      id:          user._id,
      fullName:    user.fullName,
      username:    user.username,
      role:        user.role,
      terminal:    user.terminal,
      permissions: user.permissions,
      isActive:    user.isActive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT: Update user permissions (admin only) ───────────────────────────────
router.put('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const { fullName, role, terminal, permissions, isActive, password } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (fullName)    user.fullName    = fullName;
    if (role)        user.role        = role;
    if (terminal)    user.terminal    = terminal;
    if (permissions) user.permissions = permissions;
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (password)    user.password    = password;

    await user.save();

    res.json({
      id:          user._id,
      fullName:    user.fullName,
      username:    user.username,
      role:        user.role,
      terminal:    user.terminal,
      permissions: user.permissions,
      isActive:    user.isActive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE: Delete a user (admin only) ──────────────────────────────────────
router.delete('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Prevent deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;