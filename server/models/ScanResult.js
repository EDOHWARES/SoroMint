'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * @title ScanResult Model
 * @author SoroMint Team
 * @notice Persists the outcome of every WASM security scan run through the
 *         SoroMint scanning API.  Each document represents one scan of one
 *         WASM blob and contains the full findings list, per-severity summary,
 *         and a top-level deployment gate flag.
 *
 * @dev Status values (ordered from safest to most dangerous):
 *   clean   — no findings at all
 *   passed  — no critical/high findings (may have medium/low)
 *   warning — medium/low findings only (deployment proceeds with caution)
 *   failed  — one or more critical/high findings (deployment blocked)
 *   error   — scanner could not parse the WASM at all (deployment blocked)
 */

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Location within the WASM binary where a finding was detected.
 * All fields are optional — not every rule can pinpoint an offset.
 */
const FindingLocationSchema = new mongoose.Schema(
  {
    section: { type: String }, // e.g. 'import', 'export', 'memory', 'data', 'code'
    offset: { type: Number }, // byte offset within the WASM binary
    detail: { type: String }, // free-text extra context
  },
  { _id: false }
);

/**
 * A single security finding produced by one scanner rule.
 */
const FindingSchema = new mongoose.Schema(
  {
    /**
     * Rule identifier, e.g. "SM-004".
     * Stable across scanner versions for deduplication / trend tracking.
     */
    ruleId: {
      type: String,
      required: [true, 'ruleId is required'],
      trim: true,
    },

    /**
     * Severity of the finding.
     * critical + high → deploymentBlocked = true on the parent ScanResult.
     */
    severity: {
      type: String,
      required: [true, 'severity is required'],
      enum: {
        values: ['critical', 'high', 'medium', 'low', 'info'],
        message: '{VALUE} is not a valid severity level',
      },
    },

    /** Short human-readable title, e.g. "No Soroban host imports found". */
    title: {
      type: String,
      required: [true, 'finding title is required'],
      trim: true,
    },

    /** Full explanation of what was detected and why it is risky. */
    description: {
      type: String,
      required: [true, 'finding description is required'],
    },

    /** Actionable guidance for the developer. */
    recommendation: {
      type: String,
      default: '',
    },

    /** Optional pointer into the WASM binary. */
    location: {
      type: FindingLocationSchema,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Aggregated counts — one entry per severity level plus pass/total counters.
 * Denormalised on the parent document for fast dashboard queries.
 */
const SummarySchema = new mongoose.Schema(
  {
    critical: { type: Number, default: 0, min: 0 },
    high: { type: Number, default: 0, min: 0 },
    medium: { type: Number, default: 0, min: 0 },
    low: { type: Number, default: 0, min: 0 },
    info: { type: Number, default: 0, min: 0 },
    /** Number of rules that produced no finding. */
    passedChecks: { type: Number, default: 0, min: 0 },
    /** Total rules evaluated in this scan. */
    totalChecks: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const ScanResultSchema = new mongoose.Schema(
  {
    /**
     * Stable public identifier returned to callers.
     * UUIDs are used (not the Mongo _id) so the ID is safe to share in URLs
     * and can be generated before the document is saved.
     */
    scanId: {
      type: String,
      required: [true, 'scanId is required'],
      unique: true,
      default: () => crypto.randomUUID(),
      trim: true,
    },

    /**
     * The user who submitted this scan.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },

    /**
     * SHA-256 hex digest of the raw WASM buffer.
     * Enables deduplication — if the same WASM is scanned twice the client
     * can reuse the existing result rather than scanning again.
     */
    wasmHash: {
      type: String,
      required: [true, 'wasmHash is required'],
      trim: true,
      lowercase: true,
      match: [/^[0-9a-f]{64}$/, 'wasmHash must be a 64-character hex string'],
      index: true,
    },

    /**
     * Size of the WASM binary in bytes.
     */
    wasmSize: {
      type: Number,
      required: [true, 'wasmSize is required'],
      min: [0, 'wasmSize cannot be negative'],
    },

    /**
     * Optional human-supplied label for the contract being scanned
     * (e.g. "MyToken v2 pre-deploy").
     */
    contractName: {
      type: String,
      trim: true,
      maxlength: [100, 'contractName must not exceed 100 characters'],
      default: null,
    },

    /**
     * Optional free-text notes supplied by the caller.
     */
    notes: {
      type: String,
      maxlength: [500, 'notes must not exceed 500 characters'],
      default: null,
    },

    /**
     * Overall scan outcome:
     *   clean   — zero findings
     *   passed  — no critical/high findings
     *   warning — medium/low findings only
     *   failed  — critical or high findings present
     *   error   — scanner could not parse the WASM
     */
    status: {
      type: String,
      required: [true, 'status is required'],
      enum: {
        values: ['clean', 'passed', 'warning', 'failed', 'error'],
        message: '{VALUE} is not a valid scan status',
      },
      index: true,
    },

    /**
     * All security findings emitted by the scanner for this WASM.
     * Empty array means clean.
     */
    findings: {
      type: [FindingSchema],
      default: [],
    },

    /**
     * Denormalised per-severity counts + pass/total.
     */
    summary: {
      type: SummarySchema,
      default: () => ({}),
    },

    /**
     * Wall-clock time in milliseconds taken to complete the scan.
     */
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * True when the scan result should prevent the contract from being
     * deployed (status is 'failed' or 'error').
     * Denormalised so the token-deployment gate can query this field directly.
     */
    deploymentBlocked: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },

    /**
     * Semver string identifying the scanner version that produced this result.
     * Useful for invalidating cached results after a scanner upgrade.
     */
    scannerVersion: {
      type: String,
      default: '1.0.0',
      trim: true,
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** Fast listing of all scans by a given user, newest first */
ScanResultSchema.index({ userId: 1, createdAt: -1 });

/** Lookup by status for a specific user (dashboard filter) */
ScanResultSchema.index({ userId: 1, status: 1 });

/** Deduplication query: same user + same WASM hash → reuse result */
ScanResultSchema.index({ userId: 1, wasmHash: 1 });

/** Global deduplication / cache lookup by hash */
ScanResultSchema.index({ wasmHash: 1, status: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/**
 * True when the contract may proceed to deployment
 * (status is 'clean', 'passed', or 'warning').
 */
ScanResultSchema.virtual('deploymentAllowed').get(function () {
  return !this.deploymentBlocked;
});

/**
 * Human-readable one-line summary suitable for API responses and logs.
 */
ScanResultSchema.virtual('headline').get(function () {
  const { critical, high, medium, low } = this.summary;
  if (this.status === 'error')
    return 'Scanner error — WASM could not be parsed';
  if (this.status === 'clean')
    return 'No issues found — contract is safe to deploy';
  if (this.status === 'failed')
    return `Deployment blocked: ${critical} critical, ${high} high-severity issue(s) found`;
  if (this.status === 'warning')
    return `${medium} medium, ${low} low-severity issue(s) found`;
  return `Scan ${this.status}`;
});

// ---------------------------------------------------------------------------
// Static methods
// ---------------------------------------------------------------------------

/**
 * @notice Paginated listing of scan results for one user.
 * @param {string|ObjectId} userId
 * @param {object}  [opts]
 * @param {number}  [opts.page=1]
 * @param {number}  [opts.limit=20]
 * @param {string}  [opts.status]    — optional status filter
 * @returns {Promise<{ scans: ScanResult[], totalCount: number, page: number, totalPages: number }>}
 */
ScanResultSchema.statics.findByUser = async function (
  userId,
  { page = 1, limit = 20, status } = {}
) {
  const filter = { userId };
  if (status) filter.status = status;

  const skip = (page - 1) * limit;

  const [scans, totalCount] = await Promise.all([
    this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    this.countDocuments(filter),
  ]);

  return {
    scans,
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    limit,
  };
};

/**
 * @notice Aggregate statistics for one user's scan history.
 * @param {string|ObjectId} userId
 * @returns {Promise<{
 *   total: number,
 *   byStatus: Record<string, number>,
 *   blockedCount: number,
 *   avgDuration: number,
 * }>}
 */
ScanResultSchema.statics.getStats = async function (userId) {
  const pipeline = [
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        blockedCount: { $sum: { $cond: ['$deploymentBlocked', 1, 0] } },
        avgDuration: { $avg: '$duration' },
        statusCounts: { $push: '$status' },
      },
    },
  ];

  const [result] = await this.aggregate(pipeline);
  if (!result) {
    return { total: 0, byStatus: {}, blockedCount: 0, avgDuration: 0 };
  }

  // Count per status
  const byStatus = {};
  for (const s of result.statusCounts) {
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  return {
    total: result.total,
    byStatus,
    blockedCount: result.blockedCount,
    avgDuration: Math.round(result.avgDuration || 0),
  };
};

/**
 * @notice Find the most recent passing scan for a given WASM hash.
 *         Used by the deployment gate to check if a WASM was already cleared.
 * @param {string} wasmHash  — SHA-256 hex
 * @returns {Promise<ScanResult|null>}
 */
ScanResultSchema.statics.findLatestPassingByHash = function (wasmHash) {
  return this.findOne(
    { wasmHash: wasmHash.toLowerCase(), deploymentBlocked: false },
    null,
    { sort: { createdAt: -1 } }
  );
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = mongoose.model('ScanResult', ScanResultSchema);
