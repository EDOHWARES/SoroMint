'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { getCacheService } = require('../services/cache-service');
const { searchTokens, suggest } = require('../services/token-search-service');

const searchQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  owner: z.string().length(56).startsWith('G').optional(),
  decimals: z.coerce.number().int().min(0).max(18).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const router = express.Router();

/**
 * @route GET /api/tokens/search
 * @desc  Advanced token search with fuzzy matching, filters, and suggestions
 */
router.get(
  '/tokens/search',
  authenticate,
  asyncHandler(async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const msg = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new AppError(msg, 400, 'VALIDATION_ERROR');
    }

    const { q, owner, decimals, from, to, page, limit } = parsed.data;
    const cacheKey = `tokens:search:${JSON.stringify(parsed.data)}`;
    const cacheService = getCacheService();

    const cached = await cacheService.get(cacheKey).catch(() => null);
    if (cached) return res.json({ success: true, ...cached, cached: true });

    const { data, total, suggestions } = await searchTokens({
      q,
      owner,
      decimals,
      from,
      to,
      page,
      limit,
    });

    const result = {
      data,
      suggestions,
      metadata: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        q: q ?? null,
      },
    };

    await cacheService.set(cacheKey, result).catch(() => null);

    res.json({ success: true, ...result, cached: false });
  })
);

/**
 * @route GET /api/tokens/suggest
 * @desc  Auto-complete suggestions for a partial token name/symbol query
 */
router.get(
  '/tokens/suggest',
  authenticate,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ success: true, suggestions: [] });
    if (q.length > 50)
      throw new AppError(
        'q must not exceed 50 characters',
        400,
        'VALIDATION_ERROR'
      );

    const suggestions = await suggest(q);
    res.json({ success: true, suggestions });
  })
);

module.exports = router;
