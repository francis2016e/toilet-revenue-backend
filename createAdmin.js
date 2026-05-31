require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('./models/User');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected...');

  const existing = await User.findOne({ username: 'admin' });
  if (existing) {
    console.log('Admin already exists!');
    process.exit();
  }

  await User.create({
    fullName:    'Administrator',
    username:    'admin',
    password:    'Admin2026!',
    role:        'admin',
    terminal:    'All Terminals',
    permissions: { canAdd: true, canDelete: true }
  });

  console.log('✅ Admin created! Username: admin | Password: Admin2026!');
  process.exit();
}).catch(err => {
  console.error(err);
  process.exit(1);
});