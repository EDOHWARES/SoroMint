/**
 * @title Streaming API Service
 * @notice Client-side service for interacting with the SoroMint Streaming
 *         (time-based payment stream) contract.
 *
 * API endpoints:
 *   GET  /api/streaming/streams/{streamId}       — stream details
 *   GET  /api/streaming/streams/{streamId}/balance — current withdrawable balance
 *   POST /api/streaming/streams                  — create a stream
 *   POST /api/streaming/streams/{streamId}/withdraw — withdraw
 *   DELETE /api/streaming/streams/{streamId}     — cancel a stream
 *
 * All read endpoints require auth; the dashboard uses demo fallbacks when the
 * backend is not deployed so the UI degrades gracefully.
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
// Stream contract reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Normalise a raw Stream payload into a flat, UI-ready shape.
 *
 * The backend / Soroban stream record looks like:
 *   {
 *     streamId, contractId, sender, recipient, tokenAddress,
 *     totalAmount, ratePerLedger, startLedger, stopLedger,
 *     withdrawn, status, withdrawalDelay, scheduledStartLedger, ...
 *   }
 *
 * @param {object} raw
 * @returns {object} Normalised stream with numeric coercion + display helpers.
 */
export const normaliseStream = (raw = {}) => {
  const stream = raw.data || raw;
  const now = Math.floor(Date.now() / 1000);
  const start = Number(stream.startLedger ?? stream.start_time ?? 0);
  const stop = Number(stream.stopLedger ?? stream.end_time ?? 0);
  const total = Number(stream.totalAmount ?? stream.amount ?? 0);
  const withdrawn = Number(stream.withdrawn ?? 0);

  return {
    streamId: stream.streamId ?? '',
    contractId: stream.contractId ?? stream.contractAddress ?? '',
    sender: stream.sender ?? stream.senderAddress ?? '—',
    recipient: stream.recipient ?? stream.recipientAddress ?? '—',
    tokenAddress: stream.tokenAddress ?? stream.tokenContractId ?? '—',
    totalAmount: String(stream.totalAmount ?? stream.amount ?? '0'),
    ratePerLedger: String(stream.ratePerLedger ?? stream.rate ?? '0'),
    startLedger: start,
    stopLedger: stop,
    withdrawn: String(withdrawn === 0 && stream.withdrawn === undefined ? '0' : withdrawn),
    status: stream.status ?? 'active',
    irreversible: Boolean(stream.irrevocable ?? stream.irreversible ?? false),
    isPublic: Boolean(stream.isPublic ?? false),
    // Estimated progress (0–100) based on wall-clock progress between ledgers.
    estimatedProgress:
      stop > start
        ? Math.min(100, Math.max(0, Math.round(((now - start) / (stop - start)) * 100)))
        : 0,
    createdAt: stream.createdAt ?? null,
  };
};

/**
 * @notice Compute a human-readable display status for a stream.
 * @param {string} status - Raw status from the model
 * @returns {'scheduled' | 'active' | 'completed' | 'canceled'}
 */
export const normaliseStatus = (status = 'active') => {
  const s = String(status).toLowerCase();
  if (s === 'scheduled' || s === 'completed' || s === 'canceled' || s === 'cancelled') {
    return s === 'cancelled' ? 'canceled' : s;
  }
  return 'active';
};

/**
 * @notice Classify a stream's status, taking the current ledger into account
 *         for streams whose model status is still 'active'.
 *
 * @param {object} stream - Normalised or raw stream object
 * @param {number} [currentLedger=0] - Current Soroban ledger (0 = unknown)
 * @returns {'scheduled' | 'active' | 'completed' | 'canceled'}
 */
export const classifyStreamStatus = (stream = {}, currentLedger = 0) => {
  const raw = stream.status || 'active';
  const status = String(raw).toLowerCase();
  if (status === 'completed' || status === 'canceled' || status === 'cancelled') {
    return status === 'cancelled' ? 'canceled' : status;
  }
  if (currentLedger > 0) {
    const start = Number(stream.startLedger ?? stream.start_time ?? 0);
    const stop = Number(stream.stopLedger ?? stream.end_time ?? 0);
    if (start > 0 && currentLedger < start) return 'scheduled';
    if (stop > 0 && currentLedger > stop) return 'completed';
  }
  return 'active';
};

/**
 * @notice Fetch a single stream by ID.
 * @param {number|string} streamId
 * @param {string} [token] - JWT
 * @param {object} [fallback] - Optional mock stream (demo mode).
 * @returns {Promise<object>} Normalised stream
 */
export const getStream = async (streamId, token = null, fallback = null) => {
  if (streamId === null || streamId === undefined || streamId === '') {
    throw new Error('streamId is required');
  }

  try {
    const body = await apiFetch(`/streaming/streams/${encodeURIComponent(streamId)}`, {}, token);
    return normaliseStream(body?.data ?? body);
  } catch (err) {
    if (fallback && (err.status === 404 || err.status === 501 || err.status === 502)) {
      return normaliseStream({ ...fallback, streamId: fallback.streamId || streamId });
    }
    throw err;
  }
};

/**
 * @notice Fetch the current withdrawable balance of a stream.
 * @param {number|string} streamId
 * @param {string} [token] - JWT
 * @param {string} [fallbackBalance] - Balance to use when the endpoint is missing
 * @returns {Promise<string>} Raw balance amount
 */
export const getStreamBalance = async (streamId, token = null, fallbackBalance = null) => {
  if (!streamId) throw new Error('streamId is required');

  try {
    const body = await apiFetch(`/streaming/streams/${encodeURIComponent(streamId)}/balance`, {}, token);
    return String(body?.balance ?? body?.data ?? body?.amount ?? '0');
  } catch (err) {
    if (fallbackBalance !== null && [404, 501, 502].includes(err.status)) {
      return String(fallbackBalance);
    }
    throw err;
  }
};

/**
 * @notice Convenience: fetch a stream plus its balance in parallel.
 * @param {number|string} streamId
 * @param {string} [token] - JWT
 * @param {object} [fallbacks] - { stream, balance } used when backend is absent.
 * @returns {Promise<{ stream: object, balance: string }>}
 */
export const getStreamStatus = async (streamId, token = null, fallbacks = null) => {
  if (!streamId) throw new Error('streamId is required');

  const [stream, balance] = await Promise.all([
    getStream(streamId, token, fallbacks?.stream ?? null),
    getStreamBalance(streamId, token, fallbacks?.balance ?? null),
  ]);

  return { stream, balance };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutations (require wallet auth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Create a new payment stream.
 * @param {object} payload - { recipient, tokenAddress, totalAmount, ratePerLedger, ... }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const createStream = async (payload, token = null) => {
  const { recipient, tokenAddress, totalAmount, ratePerLedger } = payload || {};
  if (!recipient) throw new Error('recipient is required');
  if (!tokenAddress) throw new Error('tokenAddress is required');
  if (!totalAmount || Number(totalAmount) <= 0) throw new Error('totalAmount must be positive');

  const body = await apiFetch(
    '/streaming/streams',
    {
      method: 'POST',
      body: JSON.stringify({ recipient, tokenAddress, totalAmount: String(totalAmount), ratePerLedger: String(ratePerLedger ?? 0) }),
    },
    token,
  );
  return body;
};

/**
 * @notice Withdraw the withdrawable balance of a stream.
 * @param {object} payload - { streamId, amount }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const withdrawStream = async (payload, token = null) => {
  const { streamId, amount } = payload || {};
  if (!streamId) throw new Error('streamId is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be positive');

  const body = await apiFetch(
    `/streaming/streams/${encodeURIComponent(streamId)}/withdraw`,
    { method: 'POST', body: JSON.stringify({ amount: String(amount) }) },
    token,
  );
  return body;
};

/**
 * @notice Cancel a stream.
 * @param {number|string} streamId
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const cancelStream = async (streamId, token = null) => {
  if (!streamId) throw new Error('streamId is required');

  const body = await apiFetch(
    `/streaming/streams/${encodeURIComponent(streamId)}`,
    { method: 'DELETE' },
    token,
  );
  return body;
};

export default {
  normaliseStream,
  normaliseStatus,
  getStream,
  getStreamBalance,
  getStreamStatus,
  createStream,
  withdrawStream,
  cancelStream,
};