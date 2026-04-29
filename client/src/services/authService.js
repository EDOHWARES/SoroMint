/**
 * @title SEP-10 Authentication Service
 * @author SoroMint Team
 * @notice Client-side service that orchestrates the full SEP-10 style
 *         challenge-response wallet authentication flow using Freighter.
 *
 * @dev Flow:
 *   1. connectFreighter()     — ask Freighter for the user's public key
 *   2. getChallenge()         — fetch a server-signed challenge transaction
 *   3. signChallenge()        — have Freighter co-sign the XDR
 *   4. login()                — submit signed XDR → receive JWT
 *   5. authenticate()         — convenience wrapper for steps 1-4
 *
 * All functions are pure async and throw descriptive Error objects so callers
 * can display meaningful feedback in the UI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Freighter API — loaded lazily so the app still boots in environments where
// the browser extension is not installed (the error surfaces only on use).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Lazily imports @stellar/freighter-api.
 * @returns {Promise<object>} The Freighter API module.
 * @throws  {Error} If the package is unavailable (should not happen in prod builds).
 */
const getFreighterApi = async () => {
  try {
    return await import('@stellar/freighter-api');
  } catch {
    throw new Error(
      'Freighter API package is not available. ' +
      'Ensure @stellar/freighter-api is installed as a dependency.'
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

/** Stellar network name passed to Freighter when requesting a signature. */
const STELLAR_NETWORK = import.meta.env.VITE_STELLAR_NETWORK || 'TESTNET';

/** Human-readable network passphrase — must match the server. */
const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE ||
  'Test SDF Network ; September 2015';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Thin fetch wrapper that throws an Error with the API's error message
 *         on non-2xx responses.
 * @param {string}  path    - Path relative to API_BASE (e.g. '/auth/challenge')
 * @param {object}  [opts]  - fetch() options
 * @returns {Promise<object>} Parsed JSON response body
 */
const apiFetch = async (path, opts = {}) => {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const message =
      body?.error ||
      body?.message ||
      `Request failed with status ${res.status}`;
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
 * @notice Checks whether the Freighter extension is installed in the browser.
 * @returns {Promise<boolean>}
 */
export const isFreighterInstalled = async () => {
  try {
    const freighter = await getFreighterApi();

    // freighter-api v2+ exposes isConnected(); earlier versions expose isConnected
    const result =
      typeof freighter.isConnected === 'function'
        ? await freighter.isConnected()
        : freighter.isConnected;

    // SDK returns either a boolean or { isConnected: boolean }
    if (typeof result === 'boolean') return result;
    if (result && typeof result.isConnected === 'boolean') return result.isConnected;

    return false;
  } catch {
    return false;
  }
};

/**
 * @notice Requests the user's Stellar public key from the Freighter extension.
 *
 * @returns {Promise<string>} The user's G-address (uppercase)
 * @throws  {Error} If Freighter is not installed or the user denies access
 */
export const connectFreighter = async () => {
  const freighter = await getFreighterApi();

  const installed = await isFreighterInstalled();
  if (!installed) {
    throw new Error(
      'Freighter wallet extension is not installed. ' +
      'Please install it from https://www.freighter.app/ and refresh the page.'
    );
  }

  let publicKey;

  try {
    // freighter-api v2: getAddress() returns { address: string }
    // freighter-api v1: getPublicKey() returns string directly
    if (typeof freighter.getAddress === 'function') {
      const result = await freighter.getAddress();
      publicKey = result?.address ?? result;
    } else if (typeof freighter.getPublicKey === 'function') {
      publicKey = await freighter.getPublicKey();
    } else {
      throw new Error('Unsupported Freighter API version — cannot retrieve public key.');
    }
  } catch (err) {
    // Re-wrap with a friendlier message unless it is already one of ours
    if (err.message?.includes('Freighter')) throw err;
    throw new Error(
      `Failed to retrieve public key from Freighter: ${err.message || err}`
    );
  }

  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error(
      'Freighter did not return a public key. ' +
      'Make sure you have an account set up in the extension.'
    );
  }

  return publicKey.toUpperCase();
};

/**
 * @notice Fetches a SEP-10 challenge transaction from the server for the given
 *         Stellar public key.
 *
 * @param  {string} publicKey - G-address of the authenticating wallet
 * @returns {Promise<{
 *   transactionXDR : string,   // base64-encoded server-signed Stellar tx
 *   challengeToken : string,   // opaque token to echo back on login
 *   expiresAt      : number,   // Unix epoch ms — sign before this time
 *   expiresInSeconds: number,
 *   serverPublicKey: string
 * }>}
 * @throws {Error} On network failure or server-side validation error
 */
export const getChallenge = async (publicKey) => {
  if (!publicKey) throw new Error('publicKey is required to fetch a challenge');

  const encoded = encodeURIComponent(publicKey);
  const body = await apiFetch(`/auth/challenge?publicKey=${encoded}`);

  if (!body?.data?.transactionXDR || !body?.data?.challengeToken) {
    throw new Error('Server returned an invalid challenge response structure');
  }

  return body.data;
};

/**
 * @notice Asks Freighter to sign the challenge transaction XDR.
 *
 * Freighter adds the user's Ed25519 signature to the existing server
 * signature, producing a fully signed envelope.
 *
 * @param  {string} transactionXDR - base64 XDR returned by getChallenge()
 * @returns {Promise<string>} base64 XDR of the fully signed transaction
 * @throws  {Error} If Freighter rejects / user cancels the signing request
 */
export const signChallenge = async (transactionXDR) => {
  if (!transactionXDR) throw new Error('transactionXDR is required');

  const freighter = await getFreighterApi();

  let signedXDR;

  try {
    // freighter-api v2: signTransaction(xdr, opts) returns { signedTxXdr: string }
    // freighter-api v1: signTransaction(xdr, network) returns the signed XDR string
    if (typeof freighter.signTransaction === 'function') {
      const result = await freighter.signTransaction(transactionXDR, {
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
        accountToSign: undefined, // let Freighter use the active account
      });

      // Handle both return shapes
      signedXDR =
        typeof result === 'string'
          ? result
          : result?.signedTxXdr ?? result?.signedTransactionXdr ?? result;
    } else {
      throw new Error('Freighter API does not expose signTransaction.');
    }
  } catch (err) {
    if (
      err.message?.toLowerCase().includes('user declined') ||
      err.message?.toLowerCase().includes('rejected') ||
      err.message?.toLowerCase().includes('cancelled') ||
      err.message?.toLowerCase().includes('canceled')
    ) {
      throw new Error('Signature request was declined. Please approve it in Freighter to log in.');
    }
    throw new Error(
      `Freighter failed to sign the challenge transaction: ${err.message || err}`
    );
  }

  if (!signedXDR || typeof signedXDR !== 'string') {
    throw new Error(
      'Freighter returned an unexpected signing result — signed XDR is missing.'
    );
  }

  return signedXDR;
};

/**
 * @notice Submits the signed challenge to the server and exchanges it for a JWT.
 *
 * @param  {string} publicKey      - Stellar G-address of the authenticating wallet
 * @param  {string} challengeToken - Token returned by getChallenge()
 * @param  {string} signedXDR      - base64 XDR signed by Freighter
 * @returns {Promise<{
 *   token     : string,  // JWT access token
 *   expiresIn : string,  // e.g. "24h"
 *   user      : {
 *     id          : string,
 *     publicKey   : string,
 *     username    : string | undefined,
 *     lastLoginAt : string | undefined
 *   }
 * }>}
 * @throws {Error} On network error or failed signature verification
 */
export const login = async (publicKey, challengeToken, signedXDR) => {
  if (!publicKey)      throw new Error('publicKey is required');
  if (!challengeToken) throw new Error('challengeToken is required');
  if (!signedXDR)      throw new Error('signedXDR is required');

  const body = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ publicKey, challengeToken, signedXDR }),
  });

  if (!body?.data?.token) {
    throw new Error('Server did not return a JWT token after successful login');
  }

  return {
    token: body.data.token,
    expiresIn: body.data.expiresIn,
    user: body.data.user,
  };
};

/**
 * @notice Registers a new user on the server with their Stellar public key.
 *
 * @param  {string}  publicKey  - G-address of the new user
 * @param  {string}  [username] - Optional display name (3-50 chars)
 * @returns {Promise<{ token: string, expiresIn: string, user: object }>}
 * @throws {Error} If the key is already registered or validation fails
 */
export const register = async (publicKey, username) => {
  if (!publicKey) throw new Error('publicKey is required');

  const payload = { publicKey };
  if (username?.trim()) payload.username = username.trim();

  const body = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!body?.data?.token) {
    throw new Error('Server did not return a JWT token after registration');
  }

  return {
    token: body.data.token,
    expiresIn: body.data.expiresIn,
    user: body.data.user,
  };
};

/**
 * @notice Fetches the authenticated user's profile from the server.
 *
 * @param  {string} token - Valid JWT access token
 * @returns {Promise<object>} User profile object
 * @throws {Error} If the token is invalid or expired
 */
export const getProfile = async (token) => {
  if (!token) throw new Error('token is required');

  const body = await apiFetch('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });

  return body?.data?.user;
};

/**
 * @notice Refreshes an existing JWT token.
 *
 * @param  {string} token - Current (still valid) JWT
 * @returns {Promise<{ token: string, expiresIn: string }>}
 */
export const refreshToken = async (token) => {
  if (!token) throw new Error('token is required');

  const body = await apiFetch('/auth/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  return {
    token: body.data.token,
    expiresIn: body.data.expiresIn,
  };
};

/**
 * @notice Full SEP-10 authentication flow in a single call.
 *
 *   1. connectFreighter()  — retrieve public key from Freighter extension
 *   2. getChallenge()      — fetch server-signed challenge transaction
 *   3. signChallenge()     — Freighter co-signs the transaction XDR
 *   4. login()             — server verifies both sigs and issues JWT
 *
 * @returns {Promise<{
 *   publicKey : string,
 *   token     : string,
 *   expiresIn : string,
 *   user      : object
 * }>}
 * @throws {Error} At any step of the flow with a descriptive message
 */
export const authenticate = async () => {
  // ── Step 1: Get public key from Freighter ─────────────────────────────────
  const publicKey = await connectFreighter();

  // ── Step 2: Fetch challenge from server ───────────────────────────────────
  const { transactionXDR, challengeToken, expiresAt } = await getChallenge(publicKey);

  // Guard: don't bother signing an already-expired challenge (clock skew etc.)
  if (Date.now() > expiresAt) {
    throw new Error(
      'The challenge transaction expired before it could be signed. ' +
      'Please try again.'
    );
  }

  // ── Step 3: Sign the challenge with Freighter ────────────────────────────
  const signedXDR = await signChallenge(transactionXDR);

  // ── Step 4: Exchange signed XDR for a JWT ───────────────────────────────
  const { token, expiresIn, user } = await login(publicKey, challengeToken, signedXDR);

  return { publicKey, token, expiresIn, user };
};

/**
 * @notice Attempt to auto-register then authenticate in one call.
 *         If the user is already registered, falls through to authenticate().
 *         If they are not yet registered, registers them first (no username),
 *         then performs the full challenge-response login.
 *
 * @returns {Promise<{
 *   publicKey  : string,
 *   token      : string,
 *   expiresIn  : string,
 *   user       : object,
 *   isNewUser  : boolean
 * }>}
 */
export const registerAndAuthenticate = async () => {
  const publicKey = await connectFreighter();

  let isNewUser = false;

  // Try to register — if the key is already taken (409) we just continue
  try {
    await register(publicKey);
    isNewUser = true;
  } catch (err) {
    if (err.status !== 409) {
      // Unexpected error during registration — surface it
      throw err;
    }
    // 409 USER_EXISTS is fine: user already registered, proceed to login
  }

  // Full challenge-response login
  const { transactionXDR, challengeToken, expiresAt } = await getChallenge(publicKey);

  if (Date.now() > expiresAt) {
    throw new Error('Challenge expired before signing. Please try again.');
  }

  const signedXDR = await signChallenge(transactionXDR);
  const { token, expiresIn, user } = await login(publicKey, challengeToken, signedXDR);

  return { publicKey, token, expiresIn, user, isNewUser };
};

export default {
  isFreighterInstalled,
  connectFreighter,
  getChallenge,
  signChallenge,
  login,
  register,
  getProfile,
  refreshToken,
  authenticate,
  registerAndAuthenticate,
};
