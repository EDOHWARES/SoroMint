/**
 * @title Voting API Service
 * @author SoroMint Team
 * @notice Client-side service for interacting with the off-chain Snapshot-style
 *         governance voting API.
 *
 * @dev All functions are async and throw descriptive Error objects on failure
 *      so callers can surface meaningful toast notifications in the UI.
 *
 * Endpoints covered:
 *   GET    /api/proposals
 *   POST   /api/proposals
 *   GET    /api/proposals/:id
 *   PATCH  /api/proposals/:id
 *   POST   /api/proposals/:id/cancel
 *   POST   /api/proposals/:id/votes
 *   GET    /api/proposals/:id/votes
 *   GET    /api/proposals/:id/results
 *   GET    /api/voting-power
 *   GET    /api/voting-power/:publicKey
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Thin fetch wrapper that throws an Error with the API's error message
 *         on non-2xx responses.
 * @param {string}  path   - Path relative to API_BASE (e.g. '/proposals')
 * @param {object}  [opts] - fetch() options
 * @param {string}  [token] - Optional JWT for Authorization header
 * @returns {Promise<object>} Parsed JSON body
 */
const apiFetch = async (path, opts = {}, token = null) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });

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
 * @param {object} params
 * @returns {string}  e.g. "?status=active&page=1"
 */
const toQueryString = (params = {}) => {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
};

// ─────────────────────────────────────────────────────────────────────────────
// Proposal operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch a paginated, filtered list of proposals.
 *
 * @param {object} [params]
 * @param {'pending'|'active'|'closed'|'cancelled'|'all'} [params.status='all']
 * @param {string}  [params.contractId]  - Filter by token contract scope
 * @param {string}  [params.creator]     - Filter by creator G-address
 * @param {string}  [params.search]      - Full-text search on title/description
 * @param {string}  [params.tags]        - Comma-separated tag filter
 * @param {number}  [params.page=1]
 * @param {number}  [params.limit=20]
 * @param {string}  [params.sortBy='createdAt']
 * @param {'asc'|'desc'} [params.sortOrder='desc']
 *
 * @returns {Promise<{
 *   proposals: object[],
 *   metadata: { totalCount: number, page: number, totalPages: number, limit: number }
 * }>}
 */
export const listProposals = async (params = {}) => {
  const qs = toQueryString(params);
  const body = await apiFetch(`/proposals${qs}`);
  return {
    proposals: body.data ?? [],
    metadata: body.metadata ?? { totalCount: 0, page: 1, totalPages: 0, limit: 20 },
  };
};

/**
 * @notice Create a new governance proposal.
 *
 * @param {object} payload
 * @param {string}   payload.title
 * @param {string}   payload.description
 * @param {string[]} payload.choices         - 2-10 voting options
 * @param {string}   payload.startTime       - ISO 8601 datetime string (future)
 * @param {string}   payload.endTime         - ISO 8601 datetime string (after startTime)
 * @param {string}   [payload.contractId]    - Optional Stellar C-address scope
 * @param {string[]} [payload.tags]          - Up to 10 freeform tags
 * @param {string}   [payload.discussionUrl] - http(s) URL
 * @param {string}   token                   - Valid JWT
 *
 * @returns {Promise<object>} Created proposal document
 */
export const createProposal = async (payload, token) => {
  if (!token) throw new Error('Authentication required to create a proposal');

  const body = await apiFetch(
    '/proposals',
    { method: 'POST', body: JSON.stringify(payload) },
    token
  );
  return body.data;
};

/**
 * @notice Fetch a single proposal by ID (includes tally).
 *
 * @param {string} proposalId - MongoDB ObjectId string
 * @returns {Promise<object>} Proposal document
 */
export const getProposal = async (proposalId) => {
  if (!proposalId) throw new Error('proposalId is required');
  const body = await apiFetch(`/proposals/${encodeURIComponent(proposalId)}`);
  return body.data;
};

/**
 * @notice Update a pending proposal (creator only).
 *
 * @param {string} proposalId
 * @param {object} updates    - Fields to update (title, description, tags, discussionUrl, endTime)
 * @param {string} token      - Valid JWT
 * @returns {Promise<object>} Updated proposal document
 */
export const updateProposal = async (proposalId, updates, token) => {
  if (!token) throw new Error('Authentication required to update a proposal');
  if (!proposalId) throw new Error('proposalId is required');

  const body = await apiFetch(
    `/proposals/${encodeURIComponent(proposalId)}`,
    { method: 'PATCH', body: JSON.stringify(updates) },
    token
  );
  return body.data;
};

/**
 * @notice Cancel a proposal (creator only; pending or active proposals only).
 *
 * @param {string} proposalId
 * @param {string} token - Valid JWT
 * @returns {Promise<object>} Cancelled proposal document
 */
export const cancelProposal = async (proposalId, token) => {
  if (!token) throw new Error('Authentication required to cancel a proposal');
  if (!proposalId) throw new Error('proposalId is required');

  const body = await apiFetch(
    `/proposals/${encodeURIComponent(proposalId)}/cancel`,
    { method: 'POST' },
    token
  );
  return body.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Voting operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Cast a vote on an active proposal.
 *
 *   Voting power is determined server-side from the voter's token holdings.
 *   One wallet can cast exactly one vote per proposal.
 *
 * @param {string} proposalId
 * @param {number} choice          - 0-based index into proposal.choices
 * @param {string} token           - Valid JWT
 * @param {string} [signedMessage] - Optional Freighter-signed message for auditability
 *
 * @returns {Promise<{
 *   vote: object,
 *   votingPower: number,
 *   choiceLabel: string,
 *   proposal: { id, title, voteCount, totalVotingPower, tally }
 * }>}
 */
export const castVote = async (proposalId, choice, token, signedMessage = null) => {
  if (!token) throw new Error('Authentication required to cast a vote');
  if (!proposalId) throw new Error('proposalId is required');
  if (typeof choice !== 'number') throw new Error('choice must be a number');

  const payload = { choice };
  if (signedMessage) payload.signedMessage = signedMessage;

  const body = await apiFetch(
    `/proposals/${encodeURIComponent(proposalId)}/votes`,
    { method: 'POST', body: JSON.stringify(payload) },
    token
  );
  return body.data;
};

/**
 * @notice Fetch the list of individual votes for a proposal.
 *
 * @param {string} proposalId
 * @param {object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @param {number} [params.choice]  - Filter to a specific choice index
 *
 * @returns {Promise<{
 *   votes: object[],
 *   metadata: { totalCount, page, totalPages, limit }
 * }>}
 */
export const listVotes = async (proposalId, params = {}) => {
  if (!proposalId) throw new Error('proposalId is required');
  const qs = toQueryString(params);
  const body = await apiFetch(
    `/proposals/${encodeURIComponent(proposalId)}/votes${qs}`
  );
  return {
    votes: body.data ?? [],
    metadata: body.metadata ?? { totalCount: 0, page: 1, totalPages: 0, limit: 20 },
  };
};

/**
 * @notice Fetch authoritative tallied results for a proposal.
 *
 * @param {string} proposalId
 * @returns {Promise<{
 *   proposal: object,
 *   results: Array<{ index, label, voteCount, totalPower, percentage }>,
 *   totalVotingPower: number,
 *   totalVoteCount: number,
 *   winningChoice: { index, label } | null
 * }>}
 */
export const getResults = async (proposalId) => {
  if (!proposalId) throw new Error('proposalId is required');
  const body = await apiFetch(
    `/proposals/${encodeURIComponent(proposalId)}/results`
  );
  return body.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Voting power
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Fetch the voting power of the currently authenticated wallet.
 *
 * @param {string} token          - Valid JWT
 * @param {string} [contractId]   - Optional C-address to scope the calculation
 *
 * @returns {Promise<{ publicKey: string, contractId: string|null, votingPower: number }>}
 */
export const getMyVotingPower = async (token, contractId = null) => {
  if (!token) throw new Error('Authentication required');

  const qs = contractId ? `?contractId=${encodeURIComponent(contractId)}` : '';
  const body = await apiFetch(`/voting-power${qs}`, {}, token);
  return body.data;
};

/**
 * @notice Fetch the voting power of any Stellar wallet (public lookup).
 *
 * @param {string} publicKey      - Stellar G-address
 * @param {string} [contractId]   - Optional C-address scope
 *
 * @returns {Promise<{ publicKey: string, contractId: string|null, votingPower: number }>}
 */
export const getVotingPower = async (publicKey, contractId = null) => {
  if (!publicKey) throw new Error('publicKey is required');

  const qs = contractId ? `?contractId=${encodeURIComponent(contractId)}` : '';
  const body = await apiFetch(
    `/voting-power/${encodeURIComponent(publicKey)}${qs}`
  );
  return body.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Default export for convenience
// ─────────────────────────────────────────────────────────────────────────────

export default {
  listProposals,
  createProposal,
  getProposal,
  updateProposal,
  cancelProposal,
  castVote,
  listVotes,
  getResults,
  getMyVotingPower,
  getVotingPower,
};
