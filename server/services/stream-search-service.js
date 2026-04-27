/**
 * Full-text Stream Search Service
 * Searches streams by sender, recipient, metadata, and notes fields.
 * Uses MongoDB Atlas Search ($search) when available, falls back to
 * regex-based search for local/dev environments.
 */

const Stream = require('../models/Stream');
const { logger } = require('../utils/logger');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Detect whether the connected MongoDB supports Atlas Search.
 * We probe by running a $search stage; if it throws a "not supported" error
 * we permanently fall back to regex mode.
 */
let atlasSearchAvailable = null;

async function probeAtlasSearch() {
  if (atlasSearchAvailable !== null) return atlasSearchAvailable;
  try {
    await Stream.aggregate([
      { $search: { index: 'stream_search', text: { query: 'probe', path: { wildcard: '*' } } } },
      { $limit: 1 },
    ]);
    atlasSearchAvailable = true;
  } catch (err) {
    // Atlas Search not available (local MongoDB, Community Edition, etc.)
    atlasSearchAvailable = false;
  }
  logger.info('[StreamSearch] Atlas Search available:', atlasSearchAvailable);
  return atlasSearchAvailable;
}

// ─── Atlas Search Pipeline ────────────────────────────────────────────────────

function buildAtlasPipeline(query, filters, skip, limit) {
  const searchStage = {
    $search: {
      index: 'stream_search',
      compound: {
        must: [
          {
            text: {
              query,
              path: ['sender', 'recipient', 'tokenAddress', 'notes', 'metadata'],
              fuzzy: { maxEdits: 1 },
            },
          },
        ],
        filter: [],
      },
    },
  };

  if (filters.status) {
    searchStage.$search.compound.filter.push({
      equals: { path: 'status', value: filters.status },
    });
  }

  return [
    searchStage,
    { $addFields: { score: { $meta: 'searchScore' } } },
    { $sort: { score: -1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        streamId: 1, contractId: 1, sender: 1, recipient: 1,
        tokenAddress: 1, totalAmount: 1, status: 1, createdAt: 1,
        notes: 1, metadata: 1, score: 1,
      },
    },
  ];
}

// ─── Regex Fallback Pipeline ──────────────────────────────────────────────────

function buildRegexPipeline(query, filters, skip, limit) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const matchStage = {
    $or: [
      { sender: regex },
      { recipient: regex },
      { tokenAddress: regex },
      { notes: regex },
      { 'metadata.key': regex },
      { 'metadata.value': regex },
    ],
  };

  if (filters.status) matchStage.status = filters.status;
  if (filters.sender) matchStage.sender = filters.sender;
  if (filters.recipient) matchStage.recipient = filters.recipient;

  return [
    { $match: matchStage },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        streamId: 1, contractId: 1, sender: 1, recipient: 1,
        tokenAddress: 1, totalAmount: 1, status: 1, createdAt: 1,
        notes: 1, metadata: 1,
      },
    },
  ];
}

// ─── Count Query ──────────────────────────────────────────────────────────────

async function countResults(query, filters, useAtlas) {
  if (useAtlas) {
    const pipeline = [
      {
        $search: {
          index: 'stream_search',
          text: { query, path: { wildcard: '*' }, fuzzy: { maxEdits: 1 } },
        },
      },
      { $count: 'total' },
    ];
    const result = await Stream.aggregate(pipeline);
    return result[0]?.total ?? 0;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  const matchQuery = {
    $or: [
      { sender: regex }, { recipient: regex }, { tokenAddress: regex },
      { notes: regex },
    ],
  };
  if (filters.status) matchQuery.status = filters.status;
  if (filters.sender) matchQuery.sender = filters.sender;
  if (filters.recipient) matchQuery.recipient = filters.recipient;

  return Stream.countDocuments(matchQuery);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search streams by a free-text query.
 *
 * @param {string} query - Search term
 * @param {object} [filters] - Optional filters: { status, sender, recipient }
 * @param {object} [pagination] - { page, limit }
 * @returns {Promise<{ results: object[], total: number, page: number, pages: number }>}
 */
async function searchStreams(query, filters = {}, pagination = {}) {
  if (!query || query.trim().length === 0) {
    return { results: [], total: 0, page: 1, pages: 0 };
  }

  const page = Math.max(1, parseInt(pagination.page) || 1);
  const limit = Math.min(MAX_LIMIT, parseInt(pagination.limit) || DEFAULT_LIMIT);
  const skip = (page - 1) * limit;

  const useAtlas = await probeAtlasSearch();

  const pipeline = useAtlas
    ? buildAtlasPipeline(query.trim(), filters, skip, limit)
    : buildRegexPipeline(query.trim(), filters, skip, limit);

  const [results, total] = await Promise.all([
    Stream.aggregate(pipeline),
    countResults(query.trim(), filters, useAtlas),
  ]);

  logger.info('[StreamSearch] Search executed', {
    query, filters, page, limit, total, engine: useAtlas ? 'atlas' : 'regex',
  });

  return {
    results,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

module.exports = { searchStreams };
