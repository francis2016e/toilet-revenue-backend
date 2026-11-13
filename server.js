const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
require('dotenv').config();

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://toilet-revenue-frontend.onrender.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true
};

// CORS first, then preflight handling
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

// Health check (works even if MongoDB is down)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'not connected'
  });
});

// Routes
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/revenue', require('./routes/revenue'));

// Error handler so errors still return a proper JSON response
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;

// Start listening first so Render sees the open port
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Then connect to MongoDB, without killing the server on failure
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
  });