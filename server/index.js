const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Token = require('./models/Token');
const stellarService = require('./services/stellar-service');
const { errorHandler, notFoundHandler, asyncHandler, AppError } = require('./middleware/error-handler');
const { authenticate } = require('./middleware/auth');
const authRoutes = require('./routes/auth-routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/soromint')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Authentication Routes (Public)
app.use('/api/auth', authRoutes);

// Public Routes
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running', network: process.env.NETWORK_PASSPHRASE });
});

// Protected Routes - Require Authentication
app.get('/api/tokens/:owner', authenticate, asyncHandler(async (req, res) => {
  const tokens = await Token.find({ ownerPublicKey: req.params.owner });
  res.json(tokens);
}));

app.post('/api/tokens', authenticate, asyncHandler(async (req, res) => {
  const { name, symbol, decimals, contractId, ownerPublicKey } = req.body;

  // Validate required fields
  if (!name || !symbol || !ownerPublicKey) {
    throw new AppError('Missing required fields: name, symbol, and ownerPublicKey are required', 400, 'VALIDATION_ERROR');
  }

  const newToken = new Token({ name, symbol, decimals, contractId, ownerPublicKey });
  await newToken.save();
  res.json(newToken);
}));

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized error handling middleware (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
