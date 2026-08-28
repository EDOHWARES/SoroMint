/**
 * @title Vault API Service
 * @notice Client-side service for interacting with the SoroMint Vault
 *         (collateralized lending) contract.
 *
 * API endpoints:
 *   GET  /api/vault/{vaultId}            — vault details
 *   GET  /api/vault/{vaultId}/health     — health factor / collateralization ratio
 *   POST /api/vault/create               — create a vault
 *   POST /api/vault/{vaultId}/add-collateral
 *   POST /api/vault/{vaultId}/mint       — mint more SMT against collateral
 *   POST /api/vault/{vaultId}/repay      — repay debt / withdraw collateral
 *   POST /api/vault/{vaultId}/liquidate  — liquidate an undercollateralized vault
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
// Vault contract reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Normalise a raw Vault payload into a flat, UI-ready shape.
 *
 * The Soroban `get_vault` / backend model returns:
 *   {
 *     vaultId, contractAddress, owner,
 *     collaterals: [{ tokenAddress, amount, valueUsd }],
 *     debt, collateralizationRatio,
 *     status: 'active' | 'liquidated' | 'closed',
 *     createdAt, lastUpdated,
 *     liquidationHistory: [{ liquidator, debtCovered, collateralSeized, timestamp }]
 *   }
 *
 * @param {object} raw
 * @returns {object} Normalised vault with numeric coercion + display helpers.
 */
export const normaliseVault = (raw = {}) => {
  const vault = raw.data || raw;
  const collaterals = Array.isArray(vault.collaterals)
    ? vault.collaterals.map((c) => ({
        tokenAddress: c.tokenAddress ?? c.token ?? '—',
        amount: String(c.amount ?? c.balance ?? '0'),
        valueUsd: Number(c.valueUsd ?? 0),
      }))
    : [];
  return {
    vaultId: vault.vaultId ?? '',
    contractAddress: vault.contractAddress ?? vault.contractId ?? '',
    owner: vault.owner ?? '—',
    collaterals,
    debt: String(vault.debt ?? '0'),
    collateralizationRatio: Number(
      vault.collateralizationRatio ?? vault.healthFactor ?? 0,
    ),
    status: vault.status ?? 'active',
    createdAt: vault.createdAt ?? null,
    lastUpdated: vault.lastUpdated ?? null,
    liquidationHistory: Array.isArray(vault.liquidationHistory)
      ? vault.liquidationHistory
      : [],
  };
};

/**
 * @notice Fetch a single vault by ID from the backend proxy.
 *
 * @param {string} vaultId - Vault ID (numeric/string)
 * @param {string} [vaultContractId] - Vault contract address
 * @param {string} [token] - JWT
 * @param {object} [fallback] - Optional mock vault used when the endpoint is
 *        not deployed (demo mode).
 * @returns {Promise<object>} Normalised Vault
 */
export const getVault = async (vaultId, vaultContractId = null, token = null, fallback = null) => {
  if (!vaultId) throw new Error('vaultId is required');

  const query = vaultContractId
    ? `?vaultContractId=${encodeURIComponent(vaultContractId)}`
    : '';

  try {
    const body = await apiFetch(`/vault/${encodeURIComponent(vaultId)}${query}`, {}, token);
    return normaliseVault(body?.data ?? body);
  } catch (err) {
    if (fallback && (err.status === 404 || err.status === 501 || err.status === 502)) {
      return normaliseVault({ ...fallback, vaultId: fallback.vaultId || vaultId });
    }
    throw err;
  }
};

/**
 * @notice Fetch the health factor (collateralization ratio) of a vault.
 * @param {string} vaultId - Vault ID
 * @param {string} [vaultContractId] - Vault contract address
 * @param {string} [token] - JWT
 * @param {number} [fallbackRatio] - Ratio to use when the endpoint is missing
 * @returns {Promise<number>}
 */
export const getVaultHealth = async (vaultId, vaultContractId = null, token = null, fallbackRatio = null) => {
  if (!vaultId) throw new Error('vaultId is required');

  const query = vaultContractId
    ? `?vaultContractId=${encodeURIComponent(vaultContractId)}`
    : '';

  try {
    const body = await apiFetch(`/vault/${encodeURIComponent(vaultId)}/health${query}`, {}, token);
    const raw = body?.data ?? body;
    const ratio =
      raw?.collateralizationRatio ?? raw?.healthFactor ?? raw?.ratio ?? raw;
    return Number(ratio ?? 0);
  } catch (err) {
    if (fallbackRatio !== null && [404, 501, 502].includes(err.status)) {
      return Number(fallbackRatio);
    }
    throw err;
  }
};

/**
 * @notice Compute the health category of a vault based on its
 *         collateralization ratio and status.
 *
 * @param {number} ratio - Collateralization ratio (percent)
 * @param {string} status - Vault status
 * @param {number} [liquidationThreshold=130] - Min healthy ratio
 * @returns {'healthy' | 'at-risk' | 'liquidated' | 'closed'}
 */
export const classifyVaultHealth = (ratio, status = 'active', liquidationThreshold = 130) => {
  if (status === 'closed') return 'closed';
  if (status === 'liquidated') return 'liquidated';
  if (Number(ratio) >= liquidationThreshold) return 'healthy';
  return 'at-risk';
};

/**
 * @notice Convenience: fetch a vault plus its health in parallel.
 * @param {string} vaultId - Vault ID
 * @param {string} [vaultContractId] - Vault contract address
 * @param {string} [token] - JWT
 * @param {object} [fallbacks] - { vault, ratio } used when the backend is absent.
 * @returns {Promise<{ vault: object, ratio: number }>}
 */
export const getVaultStatus = async (vaultId, vaultContractId = null, token = null, fallbacks = null) => {
  if (!vaultId) throw new Error('vaultId is required');

  const [vault, ratio] = await Promise.all([
    getVault(vaultId, vaultContractId, token, fallbacks?.vault ?? null),
    getVaultHealth(vaultId, vaultContractId, token, fallbacks?.ratio ?? null),
  ]);

  return { vault, ratio };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutations (require wallet auth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Create a new collateralized vault.
 * @param {object} payload - { vaultContractId, collateralToken, collateralAmount, smtAmount }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const createVault = async (payload, token = null) => {
  const { vaultContractId, collateralToken, collateralAmount, smtAmount } = payload || {};
  if (!vaultContractId) throw new Error('vaultContractId is required');
  if (!collateralToken) throw new Error('collateralToken is required');
  if (!collateralAmount || Number(collateralAmount) <= 0) throw new Error('collateralAmount must be positive');
  if (!smtAmount || Number(smtAmount) <= 0) throw new Error('smtAmount must be positive');

  const body = await apiFetch(
    '/vault/create',
    {
      method: 'POST',
      body: JSON.stringify({ vaultContractId, collateralToken, collateralAmount: String(collateralAmount), smtAmount: String(smtAmount) }),
    },
    token,
  );
  return body;
};

/**
 * @notice Add collateral to an existing vault.
 * @param {object} payload - { vaultId, vaultContractId, collateralToken, amount }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const addCollateral = async (payload, token = null) => {
  const { vaultId, vaultContractId, collateralToken, amount } = payload || {};
  if (!vaultId) throw new Error('vaultId is required');
  if (!collateralToken) throw new Error('collateralToken is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be positive');

  const body = await apiFetch(
    `/vault/${encodeURIComponent(vaultId)}/add-collateral`,
    { method: 'POST', body: JSON.stringify({ vaultContractId, collateralToken, amount: String(amount) }) },
    token,
  );
  return body;
};

/**
 * @notice Mint more SMT tokens against existing collateral.
 * @param {object} payload - { vaultId, vaultContractId, smtAmount }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const mintMore = async (payload, token = null) => {
  const { vaultId, vaultContractId, smtAmount } = payload || {};
  if (!vaultId) throw new Error('vaultId is required');
  if (!smtAmount || Number(smtAmount) <= 0) throw new Error('smtAmount must be positive');

  const body = await apiFetch(
    `/vault/${encodeURIComponent(vaultId)}/mint`,
    { method: 'POST', body: JSON.stringify({ vaultContractId, smtAmount: String(smtAmount) }) },
    token,
  );
  return body;
};

/**
 * @notice Repay debt and optionally withdraw collateral.
 * @param {object} payload - { vaultId, vaultContractId, repayAmount, collateralToken, withdrawAmount }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const repayAndWithdraw = async (payload, token = null) => {
  const { vaultId, vaultContractId, repayAmount = 0, collateralToken = null, withdrawAmount = 0 } = payload || {};
  if (!vaultId) throw new Error('vaultId is required');

  const body = await apiFetch(
    `/vault/${encodeURIComponent(vaultId)}/repay`,
    {
      method: 'POST',
      body: JSON.stringify({
        vaultContractId,
        repayAmount: String(repayAmount || 0),
        collateralToken: collateralToken || undefined,
        withdrawAmount: String(withdrawAmount || 0),
      }),
    },
    token,
  );
  return body;
};

/**
 * @notice Liquidate an undercollateralized vault.
 * @param {object} payload - { vaultId, vaultContractId, debtToCover }
 * @param {string} [token] - JWT
 * @returns {Promise<object>}
 */
export const liquidateVault = async (payload, token = null) => {
  const { vaultId, vaultContractId, debtToCover } = payload || {};
  if (!vaultId) throw new Error('vaultId is required');
  if (!debtToCover || Number(debtToCover) <= 0) throw new Error('debtToCover must be positive');

  const body = await apiFetch(
    `/vault/${encodeURIComponent(vaultId)}/liquidate`,
    { method: 'POST', body: JSON.stringify({ vaultContractId, debtToCover: String(debtToCover) }) },
    token,
  );
  return body;
};

export default {
  normaliseVault,
  getVault,
  getVaultHealth,
  classifyVaultHealth,
  getVaultStatus,
  createVault,
  addCollateral,
  mintMore,
  repayAndWithdraw,
  liquidateVault,
};
