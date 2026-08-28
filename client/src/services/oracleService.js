/**
 * @title SoroMint Price Oracle API Service
 * @notice Client-side service for interacting with the SoroMint Price Oracle
 *         contract (contracts/oracle, v2.0.0).
 *
 * The oracle aggregates price reports from a set of trusted sources and
 * exposes USD conversion helpers:
 *
 *   - get_trusted_sources()           — list of approved reporter addresses
 *   - get_price_data(token)           — { price, timestamp, source, decimals }
 *   - get_prices(tokens)              — raw i128 price per token
 *   - is_price_stale(token, max_age)  — freshness check vs. ledger timestamp
 *   - calculate_usd_value(token, amt) — USD value = amount × price ÷ 10^decimals
 *
 * Backend proxy pattern mirrors backstopService.js: callers pass an optional
 * fallback payload so the dashboard degrades gracefully in demo mode when the
 * REST proxy endpoints are not deployed yet.
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

/** Endpoints the backend proxy may not have implemented yet. */
const NOT_IMPLEMENTED = [404, 501, 502];

// ─────────────────────────────────────────────────────────────────────────────
// Normalisers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Normalise a raw PriceData payload into a flat, UI-ready shape.
 *
 * The Soroban `get_price_data(token)` call returns:
 *   { price: i128, timestamp: u64, source: Address, decimals: u32 }
 *
 * @param {object} raw
 * @returns {object} Normalised price entry with numeric coercion.
 */
export const normalisePriceData = (raw = {}) => {
  const data = raw.data || raw.priceData || raw;
  return {
    token: raw.token ?? '',
    price: Number(data.price ?? data.price ?? 0),
    timestamp: Number(data.timestamp ?? data.timestamp ?? 0),
    source: data.source ?? '—',
    decimals: Number(data.decimals ?? data.decimals ?? 7),
  };
};

/**
 * @notice Compute the human-readable price for a token given its decimals.
 *         Mirrors the on-chain representation: raw i128 price is scaled by
 *         10^decimals.
 *
 * @param {number} price - Raw integer price from the contract
 * @param {number} decimals - Token decimals
 * @returns {string} e.g. "0.1053"
 */
export const formatPrice = (price, decimals) => {
  const p = Number(price) || 0;
  const d = Number(decimals) || 0;
  if (d <= 0) return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const str = p.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  });
  return str;
};

/**
 * @notice Format a Unix timestamp into a compact "HH:MM:SS" local time string.
 * @param {number} ts - Unix seconds
 * @returns {string}
 */
export const formatTimestamp = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * @notice Compute the USD value of a token amount.
 *         Mirrors calculate_usd_value on-chain:
 *         usd_value = token_amount × price ÷ 10^decimals
 *
 * @param {number} tokenAmount - Amount of the token (human units)
 * @param {number} price - Raw integer price from the contract
 * @param {number} decimals - Token decimals
 * @returns {number} USD value (two decimal places)
 */
export const calculateUsdValue = (tokenAmount, price, decimals) => {
  const amount = Number(tokenAmount) || 0;
  const p = Number(price) || 0;
  const d = Number(decimals) || 0;
  if (amount < 0) throw new Error('token_amount must be non-negative');
  const scale = 10 ** d;
  const raw = (amount * p) / scale;
  return Math.round(raw * 100) / 100;
};

// ─────────────────────────────────────────────────────────────────────────────
// Oracle contract reads (backend proxy with demo fallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch the list of trusted reporter sources for the oracle.
 * @param {string} contractId - Stellar C-address of the oracle contract
 * @param {string} [token] - JWT
 * @param {string[]} [fallbackSources] - Used when the endpoint is not deployed
 * @returns {Promise<string[]>}
 */
export const getTrustedSources = async (contractId, token = null, fallbackSources = null) => {
  if (!contractId) throw new Error('contractId is required');

  try {
    const body = await apiFetch(
      `/oracle/${encodeURIComponent(contractId)}/sources`,
      {},
      token,
    );
    const sources = body.sources ?? body.data ?? [];
    if (!Array.isArray(sources)) return [];
    return sources.map((s) => (typeof s === 'string' ? s : s.address ?? s.source ?? String(s)));
  } catch (err) {
    if (fallbackSources && NOT_IMPLEMENTED.includes(err.status)) {
      return Array.isArray(fallbackSources) ? [...fallbackSources] : [];
    }
    throw err;
  }
};

/**
 * @notice Fetch price data for all tracked tokens.
 * @param {string} contractId - Stellar C-address
 * @param {string} [token] - JWT
 * @param {Array<object>} [fallbackPrices] - Demo price entries when endpoint missing
 * @returns {Promise<Array<object>>} Normalised price entries
 */
export const getOraclePrices = async (contractId, token = null, fallbackPrices = null) => {
  if (!contractId) throw new Error('contractId is required');

  try {
    const body = await apiFetch(
      `/oracle/${encodeURIComponent(contractId)}/prices`,
      {},
      token,
    );
    const list = body.prices ?? body.data ?? body ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((entry) =>
      normalisePriceData(typeof entry === 'object' ? entry : { token: String(entry) }),
    );
  } catch (err) {
    if (fallbackPrices && NOT_IMPLEMENTED.includes(err.status)) {
      return Array.isArray(fallbackPrices)
        ? fallbackPrices.map((p) => normalisePriceData(p))
        : [];
    }
    throw err;
  }
};

/**
 * @notice Check whether a token's price is stale (older than maxAge seconds).
 * @param {string} contractId - Stellar C-address
 * @param {string} token - Token contract address
 * @param {number} maxAge - Max age in seconds (e.g. 300)
 * @param {number} [fallbackStale] - Demo result when endpoint missing
 * @returns {Promise<boolean>}
 */
export const isPriceStale = async (contractId, token, maxAge = 300, fallbackStale = null) => {
  if (!contractId) throw new Error('contractId is required');
  if (!token) return false;

  try {
    const body = await apiFetch(
      `/oracle/${encodeURIComponent(contractId)}/stale?token=${encodeURIComponent(token)}&max_age=${maxAge}`,
      {},
      null,
    );
    return Boolean(body.stale ?? body.data ?? false);
  } catch (err) {
    if (fallbackStale !== null && NOT_IMPLEMENTED.includes(err.status)) {
      return Boolean(fallbackStale);
    }
    // Staleness is a helper signal — never hard-fail the dashboard on it.
    return false;
  }
};

/**
 * @notice Fetch the contract version string (health ping).
 * @param {string} contractId - Stellar C-address
 * @param {string} [token] - JWT
 * @param {string} [fallbackVersion] - Version when endpoint missing
 * @returns {Promise<string>}
 */
export const getOracleVersion = async (contractId, token = null, fallbackVersion = null) => {
  if (!contractId) throw new Error('contractId is required');

  try {
    const body = await apiFetch(
      `/oracle/${encodeURIComponent(contractId)}/version`,
      {},
      token,
    );
    return String(body.version ?? body.data ?? '');
  } catch (err) {
    if (fallbackVersion !== null && NOT_IMPLEMENTED.includes(err.status)) {
      return String(fallbackVersion);
    }
    throw err;
  }
};

/**
 * @notice Convenience: fetch everything the Oracle dashboard needs in parallel.
 * @param {string} contractId - Stellar C-address
 * @param {string} [token] - JWT
 * @param {object} [fallbacks] - { sources, prices, version }
 * @returns {Promise<{ sources: string[], prices: Array<object>, version: string }>}
 */
export const getOracleStatus = async (contractId, token = null, fallbacks = null) => {
  if (!contractId) throw new Error('contractId is required');

  const [sources, prices, version] = await Promise.all([
    getTrustedSources(contractId, token, fallbacks?.sources ?? null),
    getOraclePrices(contractId, token, fallbacks?.prices ?? null),
    getOracleVersion(contractId, token, fallbacks?.version ?? null),
  ]);

  return { sources, prices, version };
};

export default {
  normalisePriceData,
  formatPrice,
  formatTimestamp,
  calculateUsdValue,
  getTrustedSources,
  getOraclePrices,
  isPriceStale,
  getOracleVersion,
  getOracleStatus,
};