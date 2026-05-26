const mongoose = require('mongoose');

const RevenueSchema = new mongoose.Schema({
  terminal: {
    type: String,
    required: true,
    enum: ['Terminal 1', 'Terminal 2', 'Abakpa Terminal', 'Gariki Terminal']
  },
  date: { type: Date, required: true },
  day: { type: String, required: true },
  totalAmountPerDay: { type: Number, required: true },
  expensesDescription: { type: String, required: true },
  totalExpensesPerDay: { type: Number, required: true },
  remainingBalancePerDay: { type: Number },
  cumulativeTotal: { type: Number }
}, { timestamps: true });

module.exports = mongoose.model('Revenue', RevenueSchema);