/**
 * Stream Search Routes
 * GET /api/streaming/search?q=...&status=...&page=...&limit=...
 *
 * Debounce is handled client-side; the API itself is stateless.
 * Results are cached for 10 seconds to absorb rapid repeated queries.
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error-handler');
const { searchStreams } = require('../services/stream-search-service');
const { getCacheService } = require('../services/cache-service');
const { logger } = require('../utils/logger');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

/**
 * @route GET /api/streaming/search
 * @desc  Full-text search across streams (sender, recipient, token, notes, metadata)
 * @access Private
 */
router.get(
  '/search',
  authenticate,
  [
    query('q').isString().trim().isLength({ min: 1, max: 200 }).withMessage('q must be 1–200 chars'),
    query('status').optional().isIn(['active', 'completed', 'canceled']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const { q, status, page = 1, limit = 20 } = req.query;

    // Scope search to the authenticated user's streams
    const userKey = req.user.publicKey;
    const filters = { status };

    const cacheService = getCacheService();
    const cacheKey = `stream:search:${userKey}:${q}:${status}:${page}:${limit}`;

    const result = await cacheService.getOrSet(
      cacheKey,
      async () => {
        // Restrict results to streams the user owns
        const scopedFilters = {
          ...filters,
          $or: [{ sender: userKey }, { recipient: userKey }],
        };
        return searchStreams(q, scopedFilters, { page, limit });
      },
      { ttl: 10 } // 10-second cache — absorbs debounced rapid queries
    );

    logger.info('Stream search', {
      correlationId: req.correlationId,
      user: userKey,
      q,
      total: result.total,
    });

    res.json({ success: true, ...result });
  })
);

module.exports = router;
