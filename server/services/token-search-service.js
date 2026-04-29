'use strict';

const Token = require('../models/Token');
const { logger } = require('../utils/logger');

/**
 * Build a MongoDB aggregation pipeline for token search.
 * Uses Atlas Search ($search) when the collection has a search index,
 * otherwise falls back to $match with regex.
 *
 * @param {object} params
 * @param {string} [params.q]           - Full-text / fuzzy query
 * @param {string} [params.owner]       - Filter by ownerPublicKey
 * @param {number} [params.decimals]    - Filter by exact decimals value
 * @param {string} [params.from]        - ISO date lower bound (createdAt >=)
 * @param {string} [params.to]          - ISO date upper bound (createdAt <=)
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {boolean} [params.useAtlas]   - Force Atlas Search path (default: auto-detect)
 * @returns {Promise<{data: object[], total: number, suggestions: string[]}>}
 */
async function searchTokens({
  q,
  owner,
  decimals,
  from,
  to,
  page = 1,
  limit = 20,
}) {
  const skip = (page - 1) * limit;

  // --- Atlas Search path ---
  if (await _hasSearchIndex()) {
    return _atlasSearch({ q, owner, decimals, from, to, skip, limit });
  }

  // --- Regex fallback path ---
  return _regexSearch({ q, owner, decimals, from, to, skip, limit });
}

/**
 * Return auto-complete suggestions for a partial query string.
 * Uses Atlas Search autocomplete if available, otherwise prefix regex.
 */
async function suggest(q) {
  if (!q || q.length < 1) return [];

  if (await _hasSearchIndex()) {
    return _atlasSuggest(q);
  }

  const regex = new RegExp(`^${_escapeRegex(q)}`, 'i');
  const docs = await Token.find(
    { $or: [{ name: regex }, { symbol: regex }] },
    { name: 1, symbol: 1, _id: 0 }
  )
    .limit(10)
    .lean();

  return _dedupeSuggestions(docs);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _searchIndexCached = null;

async function _hasSearchIndex() {
  if (_searchIndexCached !== null) return _searchIndexCached;
  try {
    const indexes = await Token.collection.listSearchIndexes().toArray();
    _searchIndexCached = indexes.length > 0;
  } catch {
    _searchIndexCached = false;
  }
  return _searchIndexCached;
}

async function _atlasSearch({ q, owner, decimals, from, to, skip, limit }) {
  const mustClauses = [];

  if (q) {
    mustClauses.push({
      text: {
        query: q,
        path: ['name', 'symbol', 'description'],
        fuzzy: { maxEdits: 1, prefixLength: 2 },
      },
    });
  }

  const filterClauses = [];
  if (owner)
    filterClauses.push({ equals: { path: 'ownerPublicKey', value: owner } });
  if (decimals !== undefined)
    filterClauses.push({ equals: { path: 'decimals', value: decimals } });
  if (from || to) {
    filterClauses.push({
      range: {
        path: 'createdAt',
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    });
  }

  const searchStage = {
    $search: {
      index: 'token_search',
      compound: {
        ...(mustClauses.length ? { must: mustClauses } : {}),
        ...(filterClauses.length ? { filter: filterClauses } : {}),
      },
    },
  };

  const [results, countResult] = await Promise.all([
    Token.aggregate([
      searchStage,
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          score: { $meta: 'searchScore' },
          name: 1,
          symbol: 1,
          decimals: 1,
          contractId: 1,
          ownerPublicKey: 1,
          description: 1,
          createdAt: 1,
        },
      },
    ]),
    Token.aggregate([searchStage, { $count: 'total' }]),
  ]);

  const total = countResult[0]?.total ?? 0;
  const suggestions = _dedupeSuggestions(results.slice(0, 5));

  return { data: results, total, suggestions };
}

async function _atlasSuggest(q) {
  try {
    const results = await Token.aggregate([
      {
        $search: {
          index: 'token_search',
          autocomplete: { query: q, path: 'name', fuzzy: { maxEdits: 1 } },
        },
      },
      { $limit: 10 },
      { $project: { name: 1, symbol: 1, _id: 0 } },
    ]);
    return _dedupeSuggestions(results);
  } catch (err) {
    logger.warn('Atlas autocomplete failed, falling back', {
      error: err.message,
    });
    return [];
  }
}

async function _regexSearch({ q, owner, decimals, from, to, skip, limit }) {
  const filter = {};

  if (q) {
    const regex = new RegExp(_escapeRegex(q), 'i');
    filter.$or = [{ name: regex }, { symbol: regex }, { description: regex }];
  }
  if (owner) filter.ownerPublicKey = owner;
  if (decimals !== undefined) filter.decimals = decimals;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [data, total] = await Promise.all([
    Token.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Token.countDocuments(filter),
  ]);

  const suggestions = _dedupeSuggestions(data.slice(0, 5));
  return { data, total, suggestions };
}

function _dedupeSuggestions(docs) {
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    if (d.name && !seen.has(d.name)) {
      seen.add(d.name);
      out.push(d.name);
    }
    if (d.symbol && !seen.has(d.symbol)) {
      seen.add(d.symbol);
      out.push(d.symbol);
    }
  }
  return out.slice(0, 10);
}

function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exported for testing
function _resetIndexCache() {
  _searchIndexCached = null;
}

module.exports = { searchTokens, suggest, _resetIndexCache };
