const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * @title ApiKey Model
 * @author SoroMint Team
 * @notice Stores developer API keys used by the Developer API Gateway
 * @dev Only a SHA-256 hash of the full key is persisted. The plaintext key is
 *      returned exactly once at creation time. A short non-secret `prefix` is
 *      retained so users can identify keys in UI/logs without ever exposing
 *      the secret portion.
 */

const VALID_SCOPES = ['tokens:read', 'tokens:write', 'analytics:read'];
const VALID_TIERS = ['free', 'pro', 'enterprise'];
const VALID_STATUSES = ['active', 'revoked'];

const TIER_DEFAULT_RATE_LIMITS = {
  free: { windowMs: 60 * 1000, max: 60 },
  pro: { windowMs: 60 * 1000, max: 600 },
  enterprise: { windowMs: 60 * 1000, max: 6000 },
};

const ApiKeySchema = new mongoose.Schema(
  {
    /**
     * Owning user's Stellar public key
     */
    ownerPublicKey: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * Human-readable label for the key (e.g. "prod-backend")
     */
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    /**
     * Non-secret identifier shown to the user (first 8 chars of plaintext
     * key, prefixed with "sm_"). Safe to display in listings.
     */
    prefix: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * SHA-256 hash of the plaintext API key. Used for verification.
     */
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * Pricing/usage tier which drives the default rate limit.
     */
    tier: {
      type: String,
      enum: VALID_TIERS,
      default: 'free',
    },
    /**
     * Authorized scopes that restrict what endpoints the key can call.
     */
    scopes: {
      type: [String],
      default: ['tokens:read'],
      validate: {
        validator: (scopes) => scopes.every((s) => VALID_SCOPES.includes(s)),
        message: 'Invalid scope. Allowed: ' + VALID_SCOPES.join(', '),
      },
    },
    /**
     * Per-key rate-limit overrides. When absent, tier defaults are used.
     */
    rateLimit: {
      windowMs: { type: Number, min: 1000 },
      max: { type: Number, min: 1 },
    },
    /**
     * Lifecycle status of the key.
     */
    status: {
      type: String,
      enum: VALID_STATUSES,
      default: 'active',
      index: true,
    },
    /**
     * Optional expiration timestamp. Null/undefined means never expires.
     */
    expiresAt: {
      type: Date,
      default: null,
    },
    /**
     * Last time the key was used to authenticate a request.
     */
    lastUsedAt: {
      type: Date,
      default: null,
    },
    /**
     * Monotonic counter of successful authentications.
     */
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

ApiKeySchema.index({ ownerPublicKey: 1, status: 1 });

/**
 * @notice Computes the SHA-256 hash of a plaintext key
 * @param {string} plaintext - Full API key
 * @returns {string} Hex-encoded hash
 */
ApiKeySchema.statics.hashKey = function (plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
};

/**
 * @notice Generates a fresh random API key (plaintext)
 * @dev Key format: "sm_<base64url-40-bytes>". The "sm_" prefix allows GitHub
 *      secret scanning integrations and log scrubbers to identify the token.
 * @returns {string} Plaintext API key
 */
ApiKeySchema.statics.generatePlaintext = function () {
  const random = crypto.randomBytes(30).toString('base64url');
  return `sm_${random}`;
};

/**
 * @notice Derives the public prefix shown to the user from a plaintext key
 * @param {string} plaintext - Full API key
 * @returns {string} First 11 characters (prefix + first 8 of secret)
 */
ApiKeySchema.statics.derivePrefix = function (plaintext) {
  return plaintext.slice(0, 11);
};

/**
 * @notice Locates an active key by its plaintext value
 * @param {string} plaintext - Full API key submitted by a client
 * @returns {Promise<ApiKey|null>}
 */
ApiKeySchema.statics.findByPlaintext = async function (plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    return null;
  }
  const keyHash = this.hashKey(plaintext);
  return this.findOne({ keyHash });
};

/**
 * @notice Returns the effective rate limit for the key
 * @returns {{ windowMs: number, max: number }}
 */
ApiKeySchema.methods.getRateLimit = function () {
  const tierDefaults =
    TIER_DEFAULT_RATE_LIMITS[this.tier] || TIER_DEFAULT_RATE_LIMITS.free;
  const override = this.rateLimit || {};
  return {
    windowMs: override.windowMs || tierDefaults.windowMs,
    max: override.max || tierDefaults.max,
  };
};

/**
 * @notice Indicates whether the key is usable right now
 * @returns {boolean}
 */
ApiKeySchema.methods.isUsable = function () {
  if (this.status !== 'active') {
    return false;
  }
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
    return false;
  }
  return true;
};

/**
 * @notice Returns a client-safe representation of the key (no secrets)
 * @returns {Object}
 */
ApiKeySchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    prefix: this.prefix,
    tier: this.tier,
    scopes: this.scopes,
    rateLimit: this.getRateLimit(),
    status: this.status,
    expiresAt: this.expiresAt,
    lastUsedAt: this.lastUsedAt,
    usageCount: this.usageCount,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const ApiKey = mongoose.model('ApiKey', ApiKeySchema);

module.exports = ApiKey;
module.exports.VALID_SCOPES = VALID_SCOPES;
module.exports.VALID_TIERS = VALID_TIERS;
module.exports.VALID_STATUSES = VALID_STATUSES;
module.exports.TIER_DEFAULT_RATE_LIMITS = TIER_DEFAULT_RATE_LIMITS;
