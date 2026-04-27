/**
 * BIP-39 Key Vault Service
 * Securely manages platform-owned keypairs for automated/admin tasks.
 *
 * Security model:
 *  - The master mnemonic is NEVER stored in the DB. It lives only in env vars
 *    or a secrets manager (AWS Secrets Manager / HashiCorp Vault).
 *  - Derived keypairs are held in-memory only for the duration of a signing
 *    operation and then discarded.
 *  - Every key access is written to an immutable audit log.
 *  - Key derivation follows BIP-39 → BIP-32 (SLIP-0010 ed25519 path).
 */

const { Keypair } = require('@stellar/stellar-sdk');
const { logger } = require('../utils/logger');

// Optional: bip39 + ed25519-hd-key for proper BIP-39 derivation.
// Falls back to deterministic HMAC-SHA256 derivation if not installed,
// so the service works without adding new hard dependencies.
let bip39, derivePath, getMasterKeyFromSeed;
try {
  bip39 = require('bip39');
  ({ derivePath, getMasterKeyFromSeed } = require('ed25519-hd-key'));
} catch {
  // optional deps not installed — use built-in fallback
}

const crypto = require('crypto');

// ─── Audit Log ────────────────────────────────────────────────────────────────

const accessLog = [];

function recordAccess(purpose, derivationIndex, callerInfo) {
  const entry = {
    timestamp: new Date().toISOString(),
    purpose,
    derivationIndex,
    caller: callerInfo || 'unknown',
  };
  accessLog.push(entry);
  logger.info('[KeyVault] Key access recorded', entry);
}

function getAccessLog() {
  return [...accessLog];
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

/**
 * Derive a Stellar Keypair from the platform mnemonic.
 * Uses BIP-39 + SLIP-0010 ed25519 if deps are available,
 * otherwise falls back to HMAC-SHA256 deterministic derivation.
 *
 * @param {number} index - Derivation index (0 = fee account, 1 = admin, etc.)
 * @returns {Keypair}
 */
function deriveKeypair(index) {
  const mnemonic = process.env.PLATFORM_MNEMONIC;
  const rawSecret = process.env.PLATFORM_SECRET_KEY;

  if (!mnemonic && !rawSecret) {
    throw new Error('[KeyVault] Neither PLATFORM_MNEMONIC nor PLATFORM_SECRET_KEY is set');
  }

  // Preferred: BIP-39 derivation
  if (mnemonic && bip39 && derivePath && getMasterKeyFromSeed) {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('[KeyVault] PLATFORM_MNEMONIC is not a valid BIP-39 mnemonic');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const masterKey = getMasterKeyFromSeed(seed.toString('hex'));
    // SLIP-0010 path: m/44'/148'/<index>'  (Stellar coin type = 148)
    const { key } = derivePath(`m/44'/148'/${index}'`, masterKey.key.toString('hex'));
    return Keypair.fromRawEd25519Seed(Buffer.from(key, 'hex'));
  }

  // Fallback: HMAC-SHA256 deterministic derivation from raw secret
  if (rawSecret) {
    if (index === 0) {
      return Keypair.fromSecret(rawSecret);
    }
    const derived = crypto
      .createHmac('sha256', rawSecret)
      .update(`soromint-key-index-${index}`)
      .digest();
    return Keypair.fromRawEd25519Seed(derived);
  }

  throw new Error('[KeyVault] Key derivation failed — no valid source available');
}

// ─── Named Key Slots ──────────────────────────────────────────────────────────

const KEY_SLOTS = {
  FEE_ACCOUNT: 0,   // Pays transaction fees on behalf of users
  ADMIN: 1,         // Administrative contract calls
  AUTOMATION: 2,    // Scheduled/automated tasks
};

/**
 * Get a keypair for a named purpose.
 * Logs every access for audit purposes.
 *
 * @param {'FEE_ACCOUNT'|'ADMIN'|'AUTOMATION'} purpose
 * @param {string} [callerInfo] - Route/service requesting the key (for audit)
 * @returns {Keypair}
 */
function getKeypairForPurpose(purpose, callerInfo) {
  const index = KEY_SLOTS[purpose];
  if (index === undefined) {
    throw new Error(`[KeyVault] Unknown key purpose: ${purpose}`);
  }
  recordAccess(purpose, index, callerInfo);
  return deriveKeypair(index);
}

/**
 * Sign a transaction buffer with the platform key for a given purpose.
 * The keypair is derived, used to sign, and then the reference is dropped.
 *
 * @param {'FEE_ACCOUNT'|'ADMIN'|'AUTOMATION'} purpose
 * @param {import('@stellar/stellar-sdk').Transaction} transaction
 * @param {string} [callerInfo]
 * @returns {import('@stellar/stellar-sdk').Transaction} signed transaction
 */
function signWithPlatformKey(purpose, transaction, callerInfo) {
  const keypair = getKeypairForPurpose(purpose, callerInfo);
  transaction.sign(keypair);
  logger.info('[KeyVault] Transaction signed', { purpose, callerInfo });
  return transaction;
}

/**
 * Return the public key for a given purpose (safe to expose).
 * @param {'FEE_ACCOUNT'|'ADMIN'|'AUTOMATION'} purpose
 * @returns {string} Stellar public key (G...)
 */
function getPublicKeyForPurpose(purpose) {
  const index = KEY_SLOTS[purpose];
  if (index === undefined) throw new Error(`[KeyVault] Unknown key purpose: ${purpose}`);
  return deriveKeypair(index).publicKey();
}

module.exports = {
  getKeypairForPurpose,
  signWithPlatformKey,
  getPublicKeyForPurpose,
  getAccessLog,
  KEY_SLOTS,
};
