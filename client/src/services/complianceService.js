/**
 * @title Compliance API Service
 * @notice Client-side service for fetching and interacting with the SoroMint
 *         Compliance contract state — blacklist entries, clawback audit
 *         records, and contract configuration.
 *
 * API endpoints (built on the generic event indexer from docs/architecture/compliance.md):
 *   GET  /api/compliance/status        — blacklist count, clawback count, config
 *   GET  /api/compliance/blacklist     — list of blacklisted addresses
 *   GET  /api/compliance/clawbacks     — list of clawback audit records
 *
 * The Compliance contract emits `bl_upd`, `clwbk`, `cfg_upd`, `token_set`,
 * and `cb_admin` events which the backend indexes into MongoDB (SorobanEvent
 * collection) and serves through the endpoints above.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Thin fetch wrapper — throws an Error with the API error message on
 *         non-2xx responses.
 */
const apiFetch = async (path, opts = {}, token = null) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const message =
      body?.error || body?.message || `Request failed with status ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }

  return body;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch compliance snapshot (blacklist + clawback + config summary).
 *
 * @param {string}  [token]    — Optional JWT auth token
 * @param {object}  [fallback] — Optional mock data used when the backend
 *                               endpoint is not deployed (demo mode)
 * @returns {Promise<object>} Compliance status object
 */
export const getComplianceStatus = async (token = null, fallback = null) => {
  try {
    const body = await apiFetch('/compliance/status', {}, token);
    return body?.data || body;
  } catch (err) {
    if (fallback && (err.status === 404 || err.status === 501 || err.status === 502)) {
      return fallback;
    }
    throw err;
  }
};

/**
 * @notice Fetch the list of blacklisted addresses.
 *
 * @param {string}  [token]    — Optional JWT auth token
 * @param {Array}   [fallback] — Optional mock data used in demo mode
 * @returns {Promise<Array<object>>} Blacklist entries
 */
export const getBlacklist = async (token = null, fallback = null) => {
  try {
    const body = await apiFetch('/compliance/blacklist', {}, token);
    return Array.isArray(body) ? body : body?.data || body?.entries || [];
  } catch (err) {
    if (fallback && (err.status === 404 || err.status === 501 || err.status === 502)) {
      return fallback;
    }
    throw err;
  }
};

/**
 * @notice Fetch clawback audit records.
 *
 * @param {string}  [token]    — Optional JWT auth token
 * @param {Array}   [fallback] — Optional mock data used in demo mode
 * @returns {Promise<Array<object>>} Clawback records
 */
export const getClawbacks = async (token = null, fallback = null) => {
  try {
    const body = await apiFetch('/compliance/clawbacks', {}, token);
    return Array.isArray(body) ? body : body?.data || body?.records || [];
  } catch (err) {
    if (fallback && (err.status === 404 || err.status === 501 || err.status === 502)) {
      return fallback;
    }
    throw err;
  }
};

/**
 * @notice Format a blacklist entry for display.
 *
 * @param {object} entry — { address, banned, reason?, updatedAt }
 * @returns {object} Formatted entry
 */
export const formatBlacklistEntry = (entry = {}) => ({
  id: entry._id || entry.id || entry.address || '',
  address: entry.address || entry.addr || '—',
  banned: entry.banned ?? entry.status === 'banned',
  reason: entry.reason || '—',
  updatedAt: entry.updatedAt || entry.createdAt || '—',
});

/**
 * @notice Format a clawback record for display.
 *
 * @param {object} record — ClawbackRecord shape from the Compliance contract
 * @returns {object} Formatted record
 */
export const formatClawbackRecord = (record = {}) => ({
  id: record.id ?? record.recordId ?? record._id ?? '',
  source: record.source || record.from || '—',
  amount: record.amount ?? 0,
  reason: record.reason || '—',
  jurisdiction: record.jurisdiction || '—',
  timestamp: record.timestamp || record.ledgerTimestamp || record.createdAt || '—',
});