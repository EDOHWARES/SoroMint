const express = require('express');
const SorobanEvent = require('../models/SorobanEvent');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

router.get('/events', authenticate, async (req, res) => {
  try {
    const { 
      contractId, 
      eventType, 
      startLedger, 
      endLedger,
      page = 1, 
      limit = 50 
    } = req.query;

    const query = {};
    if (contractId) query.contractId = contractId;
    if (eventType) query.eventType = eventType;
    if (startLedger || endLedger) {
      query.ledger = {};
      if (startLedger) query.ledger.$gte = parseInt(startLedger);
      if (endLedger) query.ledger.$lte = parseInt(endLedger);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const events = await SorobanEvent.find(query)
      .sort({ ledger: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await SorobanEvent.countDocuments(query);

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch events', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

router.get('/events/stats', authenticate, async (req, res) => {
  try {
    const stats = await SorobanEvent.aggregate([
      {
        $group: {
          _id: '$contractId',
          eventCount: { $sum: 1 },
          lastEvent: { $max: '$ledgerClosedAt' },
        },
      },
      { $sort: { eventCount: -1 } },
      { $limit: 10 },
    ]);

    res.json({ stats });
  } catch (error) {
    logger.error('Failed to fetch event stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
