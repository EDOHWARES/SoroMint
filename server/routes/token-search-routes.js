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
 * @openapi
 * @route GET /api/tokens/search
 * @name searchTokens
 * @description Advanced token search with fuzzy matching, filters, and suggestions
 * @tags Tokens
 * @security BearerAuth
 * @param {string} q - Search query for name/symbol (optional)
 * @param {string} owner - Filter by owner Stellar public key (G...)
 * @param {integer} decimals - Filter by token decimals (optional)
 * @param {string} from - Filter tokens created after this datetime (ISO 8601)
 * @param {string} to - Filter tokens created before this datetime (ISO 8601)
 * @param {integer} page - Page number (optional, default: 1)
 * @param {integer} limit - Results per page (optional, default: 20, max: 100)
 * @returns {object} 200 - Search results with suggestions and pagination
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
 * @openapi
 * @route GET /api/tokens/suggest
 * @name getTokenSuggestions
 * @description Auto-complete suggestions for a partial token name/symbol query
 * @tags Tokens
 * @security BearerAuth
 * @param {string} q - Partial query (max 50 characters)
 * @returns {object} 200 - Array of suggestions
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
