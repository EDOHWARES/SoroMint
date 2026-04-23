/**
 * @title SEP-10 Challenge-Response Authentication Service
 * @author SoroMint Team
 * @notice Implements a Stellar SEP-10 style wallet ownership proof mechanism.
 *         The server generates a signed Stellar transaction as a challenge.
 *         The client (via Freighter) must co-sign it to prove key ownership.
 * @dev Challenges are stored in-memory with TTL. A background sweep removes
 *      expired entries every 5 minutes. For multi-instance deployments this
 *      should be backed by Redis (swap Map for the cache-service).
 *
 * Flow:
 *   1. Client calls GET /api/auth/challenge?publicKey=G...
 *   2. Server builds a Stellar transaction:
 *        - source  : server keypair (sequence -1, no on-chain account needed)
 *        - op[0]   : ManageData("web_auth_domain", WEB_AUTH_DOMAIN)  source = server
 *        - op[1]   : ManageData("<domain> auth",   <32-byte nonce>)  source = client
 *        - timeBounds: [now, now + 300s]
 *      Server signs it and returns the base64-XDR + a challenge token.
 *   3. Client signs the XDR with Freighter and POSTs:
 *        { publicKey, challengeToken, signedXDR }
 *   4. Server verifies both server + client signatures and issues a JWT.
 */

'use strict';

const crypto = require('crypto');
const {
  Keypair,
  TransactionBuilder,
  Transaction,
  Operation,
  Account,
} = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long (in seconds) a challenge remains valid for the client to sign. */
const CHALLENGE_WINDOW_SECONDS = 300; // 5 minutes

/** Human-readable domain embedded in the ManageData operation name. */
const WEB_AUTH_DOMAIN = 'soromint.app';

/** How often (ms) the in-process sweep runs to drop expired challenges. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// In-memory challenge store
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ChallengeEntry
 * @property {string}  publicKey       - Client G-address this challenge was issued for
 * @property {string}  transactionXDR  - Server-signed base64 XDR given to the client
 * @property {number}  expiresAt       - Unix epoch ms after which the challenge is void
 * @property {boolean} used            - True once successfully verified (replay guard)
 */

/** @type {Map<string, ChallengeEntry>} */
const _store = new Map();

// Periodic cleanup so the map never grows unboundedly.
const _sweepTimer = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [token, entry] of _store.entries()) {
    if (entry.expiresAt < now) {
      _store.delete(token);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug('[SEP-10] Swept expired challenges', { removed, remaining: _store.size });
  }
}, SWEEP_INTERVAL_MS);

// Allow Node to exit cleanly even if the interval is still alive.
if (_sweepTimer.unref) _sweepTimer.unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @notice Returns the server Keypair used for signing challenges.
 * @dev    Reads SERVER_SIGNING_SECRET from env. Falls back to a deterministic
 *        ephemeral key in development so tests and local runs work without
 *        extra configuration (not safe for production).
 * @returns {Keypair}
 */
const _getServerKeypair = () => {
  const env = getEnv();

  if (env.SERVER_SIGNING_SECRET) {
    return Keypair.fromSecret(env.SERVER_SIGNING_SECRET);
  }

  // Development / test fallback — deterministic so challenges survive the
  // lifetime of a single process but should NEVER be used in production.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SERVER_SIGNING_SECRET must be set in production. ' +
      'Generate one with: node -e "const {Keypair}=require(\'@stellar/stellar-sdk\');console.log(Keypair.random().secret())"'
    );
  }

  logger.warn(
    '[SEP-10] SERVER_SIGNING_SECRET not set — using insecure ephemeral key. ' +
    'Set SERVER_SIGNING_SECRET in your .env for a stable signing identity.'
  );

  // Deterministic within one process lifetime
  if (!_getServerKeypair._fallbackKeypair) {
    _getServerKeypair._fallbackKeypair = Keypair.random();
  }
  return _getServerKeypair._fallbackKeypair;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @notice Generates a SEP-10 style challenge transaction for a given Stellar
 *         public key and stores it server-side until verified or expired.
 *
 * @param  {string} clientPublicKey - The G-address of the authenticating wallet
 * @returns {{
 *   transactionXDR: string,   // base64-encoded XDR of the server-signed tx
 *   challengeToken: string,   // opaque token the client must echo back
 *   expiresAt: number,        // Unix epoch ms
 *   serverPublicKey: string   // The server key that signed the challenge
 * }}
 * @throws {Error} If the public key is syntactically invalid or env is mis-configured
 */
const generateChallenge = (clientPublicKey) => {
  const env = getEnv();
  const serverKeypair = _getServerKeypair();

  // Build a source Account with sequence -1.
  // Using sequence -1 means the first transaction will use sequence 0,
  // which is fine since we never submit this tx to the network.
  const serverAccount = new Account(serverKeypair.publicKey(), '-1');

  const nonce = crypto.randomBytes(32).toString('base64');
  const nowSec = Math.floor(Date.now() / 1000);
  const minTime = nowSec;
  const maxTime = nowSec + CHALLENGE_WINDOW_SECONDS;

  const tx = new TransactionBuilder(serverAccount, {
    fee: '100',
    networkPassphrase: env.NETWORK_PASSPHRASE,
  })
    // op[0]: attests the server's web-auth domain
    .addOperation(
      Operation.manageData({
        name: 'web_auth_domain',
        value: WEB_AUTH_DOMAIN,
        source: serverKeypair.publicKey(),
      })
    )
    // op[1]: attests client key ownership — source = client so client MUST sign
    .addOperation(
      Operation.manageData({
        name: `${WEB_AUTH_DOMAIN} auth`,
        value: nonce,
        source: clientPublicKey,
      })
    )
    .setTimebounds(minTime, maxTime)
    .build();

  // Server signs the challenge transaction.
  tx.sign(serverKeypair);

  const transactionXDR = tx.toEnvelope().toXDR('base64');
  const challengeToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = maxTime * 1000; // store as ms

  _store.set(challengeToken, {
    publicKey: clientPublicKey,
    transactionXDR,
    expiresAt,
    used: false,
  });

  logger.info('[SEP-10] Challenge generated', {
    publicKey: clientPublicKey,
    tokenPrefix: challengeToken.substring(0, 8) + '…',
    expiresAt: new Date(expiresAt).toISOString(),
  });

  return {
    transactionXDR,
    challengeToken,
    expiresAt,
    serverPublicKey: serverKeypair.publicKey(),
  };
};

/**
 * @notice Verifies a signed challenge transaction submitted by the client.
 *
 * Checks performed (in order):
 *   1. Challenge token exists in the store
 *   2. Challenge has not already been used (replay prevention)
 *   3. Challenge has not expired
 *   4. The signed XDR can be parsed against the expected network passphrase
 *   5. The transaction's time bounds are still valid at the moment of verification
 *   6. The transaction contains at least two ManageData operations
 *   7. The server's signature over the transaction hash is present and valid
 *   8. The client's signature over the transaction hash is present and valid
 *
 * On success, the challenge is immediately marked as used so it cannot be
 * replayed even if called again within the validity window.
 *
 * @param  {string} challengeToken       - Token returned by generateChallenge
 * @param  {string} signedTransactionXDR - base64 XDR of the fully signed tx
 * @returns {{ valid: boolean, publicKey?: string, error?: string }}
 */
const verifyChallenge = (challengeToken, signedTransactionXDR) => {
  const env = getEnv();

  // ── 1. Token look-up ─────────────────────────────────────────────────────
  const stored = _store.get(challengeToken);
  if (!stored) {
    return { valid: false, error: 'Challenge not found or already expired' };
  }

  // ── 2. Replay guard ──────────────────────────────────────────────────────
  if (stored.used) {
    return { valid: false, error: 'Challenge has already been used' };
  }

  // ── 3. Expiry check ───────────────────────────────────────────────────────
  if (stored.expiresAt < Date.now()) {
    _store.delete(challengeToken);
    return { valid: false, error: 'Challenge has expired' };
  }

  // ── 4–8. Cryptographic verification ──────────────────────────────────────
  try {
    const tx = new Transaction(signedTransactionXDR, env.NETWORK_PASSPHRASE);

    // ── 4. Time bounds ───────────────────────────────────────────────────
    if (!tx.timeBounds) {
      return { valid: false, error: 'Transaction is missing time bounds' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const minTime = parseInt(tx.timeBounds.minTime, 10);
    const maxTime = parseInt(tx.timeBounds.maxTime, 10);

    if (nowSec < minTime) {
      return { valid: false, error: 'Transaction is not yet valid (minTime in the future)' };
    }
    if (nowSec > maxTime) {
      return { valid: false, error: 'Transaction time bounds have expired' };
    }

    // ── 5. Operation count ───────────────────────────────────────────────
    if (tx.operations.length < 2) {
      return { valid: false, error: 'Challenge transaction must contain at least 2 operations' };
    }

    // ── 6. Verify domain operation ───────────────────────────────────────
    const domainOp = tx.operations[0];
    if (domainOp.type !== 'manageData' || domainOp.name !== 'web_auth_domain') {
      return { valid: false, error: 'First operation must be a web_auth_domain ManageData' };
    }

    // ── 7 & 8. Signature verification ────────────────────────────────────
    const serverKeypair = _getServerKeypair();
    const clientKeypair = Keypair.fromPublicKey(stored.publicKey);
    const txHash = tx.hash();

    let hasValidServerSig = false;
    let hasValidClientSig = false;

    for (const decoratedSig of tx.signatures) {
      const hint = decoratedSig.hint();
      const signature = decoratedSig.signature();

      if (!hasValidServerSig && hint.equals(serverKeypair.signatureHint())) {
        hasValidServerSig = serverKeypair.verify(txHash, signature);
      }

      if (!hasValidClientSig && hint.equals(clientKeypair.signatureHint())) {
        hasValidClientSig = clientKeypair.verify(txHash, signature);
      }

      // Short-circuit once both found
      if (hasValidServerSig && hasValidClientSig) break;
    }

    if (!hasValidServerSig) {
      return { valid: false, error: 'Server signature on challenge is missing or invalid' };
    }

    if (!hasValidClientSig) {
      return {
        valid: false,
        error: 'Client signature is missing or invalid — make sure you signed with the correct keypair',
      };
    }

    // ── Mark as used (prevents replay within the validity window) ─────────
    stored.used = true;

    logger.info('[SEP-10] Challenge verified successfully', {
      publicKey: stored.publicKey,
      tokenPrefix: challengeToken.substring(0, 8) + '…',
    });

    return { valid: true, publicKey: stored.publicKey };

  } catch (err) {
    logger.error('[SEP-10] Challenge verification threw an exception', {
      error: err.message,
      tokenPrefix: challengeToken.substring(0, 8) + '…',
    });
    return { valid: false, error: `Verification error: ${err.message}` };
  }
};

/**
 * @notice Returns the number of active (non-expired, non-used) challenges.
 *         Useful for health-check / monitoring endpoints.
 * @returns {number}
 */
const getActiveChallengeCount = () => {
  const now = Date.now();
  let count = 0;
  for (const entry of _store.values()) {
    if (!entry.used && entry.expiresAt > now) count++;
  }
  return count;
};

/**
 * @notice Clears all stored challenges.
 *         Intended only for use in tests — do not call in production code.
 */
const _clearAllChallenges = () => {
  _store.clear();
};

module.exports = {
  generateChallenge,
  verifyChallenge,
  getActiveChallengeCount,
  _clearAllChallenges, // exported for test teardown only
  CHALLENGE_WINDOW_SECONDS,
  WEB_AUTH_DOMAIN,
};
