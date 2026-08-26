/**
 * @title Token Factory API Service
 * @notice Client-side service for interacting with the Token Factory.
 *
 * Two integration modes:
 *   1. Backend REST API — registers deployed tokens in MongoDB, retrieves the
 *      factory registry, and fetches on-chain token metadata through the
 *      Soroban RPC proxy on the backend.
 *   2. Direct Soroban RPC (via `getFactoryStatus`) — read-only health ping that
 *      calls `version()` / `status()` on the factory contract without auth.
 *
 * All functions throw descriptive Error objects on failure so callers can
 * surface meaningful toast notifications in the UI.
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

/**
 * @notice Serialises a plain object into a URL query string, omitting
 *         undefined / null / empty-string values.
 */
const toQueryString = (params = {}) => {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
};

// ─────────────────────────────────────────────────────────────────────────────
// Token CRUD (backed by /api/tokens)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch all tokens deployed by a specific owner address.
 * @param {string} ownerPublicKey - Stellar G-address
 * @param {object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @param {string} [params.search]
 * @param {string} token - JWT
 * @returns {Promise<{ data: object[], metadata: object }>}
 */
export const getTokensByOwner = async (ownerPublicKey, params = {}, token) => {
  if (!ownerPublicKey) throw new Error('ownerPublicKey is required');
  const qs = toQueryString(params);
  const body = await apiFetch(`/tokens/${encodeURIComponent(ownerPublicKey)}${qs}`, {}, token);
  return {
    data: body.data ?? [],
    metadata: body.metadata ?? { totalCount: 0, page: 1, totalPages: 1, limit: 20 },
  };
};

/**
 * @notice Register a newly deployed token contract in the backend database.
 *
 * The frontend is responsible for building and submitting the Soroban
 * transaction via Freighter; this call records the result.
 *
 * @param {object} payload
 * @param {string} payload.name
 * @param {string} payload.symbol
 * @param {number} payload.decimals
 * @param {string} payload.contractId  - Stellar C-address of the new token
 * @param {string} payload.ownerPublicKey
 * @param {string} [payload.scanId]     - Optional pre-flight security scan ID
 * @param {string} token - JWT
 * @returns {Promise<object>} Created token document
 */
export const deployToken = async (payload, token) => {
  if (!token) throw new Error('Authentication required to deploy a token');

  const body = await apiFetch(
    '/tokens',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
  // The endpoint returns the raw MongoDB document (not wrapped in data:{})
  return body;
};

/**
 * @notice Fetch on-chain metadata (name, symbol, decimals) for a token contract
 *         via the backend Soroban RPC proxy.
 * @param {string} contractId - Stellar C-address
 * @param {string} token - JWT
 * @returns {Promise<{ name: string, symbol: string, decimals: number }>}
 */
export const getTokenMetadata = async (contractId, token) => {
  if (!contractId) throw new Error('contractId is required');
  const body = await apiFetch(
    `/tokens/metadata/${encodeURIComponent(contractId)}`,
    {},
    token,
  );
  return body.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory-level reads (lightweight status / metrics)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch a summary of the factory state by aggregating token data
 *         already in the backend database.  Does NOT require an on-chain call.
 *
 * @param {string} ownerPublicKey - Stellar G-address of the connected wallet
 * @param {string} token - JWT
 * @returns {Promise<{
 *   totalDeployed: number,
 *   recentTokens: object[],
 * }>}
 */
export const getFactoryMetrics = async (ownerPublicKey, token) => {
  if (!ownerPublicKey) {
    return { totalDeployed: 0, recentTokens: [] };
  }

  const { data, metadata } = await getTokensByOwner(
    ownerPublicKey,
    { limit: 5, page: 1 },
    token,
  );

  return {
    totalDeployed: metadata.totalCount ?? data.length,
    recentTokens: data,
  };
};

export default {
  getTokensByOwner,
  deployToken,
  getTokenMetadata,
  getFactoryMetrics,
};
