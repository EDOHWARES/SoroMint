const express = require('express');
const Stream = require('../models/Stream');
const { asyncHandler } = require('../middleware/error-handler');
const { discoveryRateLimiter } = require('../middleware/rate-limiter');
const { z } = require('zod');

const router = express.Router();

const discoveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * @route GET /api/discovery/streams
 * @desc  List all public streams with featured sorting
 * @access Public
 */
router.get(
  '/discovery/streams',
  discoveryRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = discoveryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters', 
        details: parsed.error.errors 
      });
    }

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const query = { isPublic: true, status: 'active' };
    
    const [streams, total] = await Promise.all([
      Stream.find(query)
        .sort({ isFeatured: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Stream.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: streams,
      metadata: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  })
);

module.exports = router;
