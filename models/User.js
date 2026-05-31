const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    fullName: {
      type:      String,
      required:  true,
      trim:      true
    },
    username: {
      type:      String,
      required:  true,
      unique:    true,
      trim:      true,
      lowercase: true
    },
    password: {
      type:     String,
      required: true
    },
    role: {
      type:    String,
      enum:    ['admin', 'user'],
      default: 'user'
    },
    terminal: {
      type: String,
      enum: [
        'All Terminals',
        'Terminal 1',
        'Terminal 2',
        'Abakpa Terminal',
        'Gariki Terminal'
      ],
      default: 'All Terminals'
    },
    permissions: {
      canAdd:    { type: Boolean, default: false },
      canDelete: { type: Boolean, default: false }
    },
    isActive: {
      type:    Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Hash password before saving — fixed syntax
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare password method
UserSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);