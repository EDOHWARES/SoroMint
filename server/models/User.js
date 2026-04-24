const mongoose = require('mongoose');

/**
 * @title User Model
 * @author SoroMint Team
 * @notice Stores user information including Stellar public keys for authentication
 * @dev Public keys are stored as-is (they are public by nature), but validated for format
 */

const UserSchema = new mongoose.Schema({
  /**
   * Stellar public key (account ID)
   * Format: G followed by 55 base32 characters (e.g., GABC...XYZ)
   */
  publicKey: {
    type: String,
    required: false,
    unique: true,
    sparse: true, // Allow multiple nulls but enforce uniqueness for non-null values
    trim: true,
    validate: {
      validator: function (value) {
        if (!value) return true;
        return /^G[A-Z2-7]{55}$/.test(value);
      },
      message: 'Invalid Stellar public key format.'
    }
  },
  /**
   * User's email address (from social profiles)
   */
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  /**
   * Google OAuth2 ID
   */
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  /**
   * GitHub OAuth2 ID
   */
  githubId: {
    type: String,
    unique: true,
    sparse: true
  },
  /**
   * URL to user's profile picture
   */
  avatarUrl: {
    type: String
  },
  /**
   * Optional username/nickname for the user
   */
  username: {
    type: String,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [50, 'Username cannot exceed 50 characters']
  },
  /**
   * Account creation timestamp
   */
  createdAt: {
    type: Date,
    default: Date.now
  },
  /**
   * Last login timestamp
   */
  lastLoginAt: {
    type: Date
  },
  /**
   * Account status (active, suspended, deleted)
   */
  status: {
    type: String,
    enum: ['active', 'suspended', 'deleted'],
    default: 'active'
  },
  /**
   * User role for access control
   */
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  /**
   * Whether the user has opted into sponsored transactions
   */
  sponsorshipEnabled: {
    type: Boolean,
    default: false,
  },
  /**
   * Sponsorship approval lifecycle state
   */
  sponsorshipStatus: {
    type: String,
    enum: ['inactive', 'pending', 'approved', 'rejected', 'suspended'],
    default: 'inactive',
  },
  /**
   * Maximum lifetime sponsorship budget allocated to the user, in stroops
   */
  sponsorshipBudgetLimitStroops: {
    type: Number,
    default: 0,
    min: [0, 'Sponsorship budget limit cannot be negative'],
  },
  /**
   * Lifetime sponsored fee usage for the user, in stroops
   */
  sponsorshipBudgetUsedStroops: {
    type: Number,
    default: 0,
    min: [0, 'Sponsorship budget used cannot be negative'],
  },
  /**
   * Most recent time sponsorship was approved
   */
  sponsorshipApprovedAt: {
    type: Date,
  },
  /**
   * Most recent time a sponsored transaction was executed
   */
  sponsorshipLastSponsoredAt: {
    type: Date,
  }
}, {
  timestamps: true
});

/**
 * @notice Ensure at least one authentication method is present
 */
UserSchema.pre('save', function (next) {
  if (!this.publicKey && !this.googleId && !this.githubId) {
    return next(new Error('At least one authentication method (Stellar, Google, or GitHub) is required.'));
  }
  next();
});

/**
 * @notice Index for efficient public key lookups
 */
UserSchema.index({ publicKey: 1 });

/**
 * @notice Static method to find user by public key (case-insensitive)
 * @param {string} publicKey - The Stellar public key to search for
 * @returns {Promise<User|null>} The user document or null
 */
UserSchema.statics.findByPublicKey = async function (publicKey) {
  return this.findOne({ publicKey: publicKey.toUpperCase() });
};

/**
 * @notice Instance method to update last login timestamp
 * @returns {Promise<User>} The updated user document
 */
UserSchema.methods.updateLastLogin = async function () {
  this.lastLoginAt = new Date();
  return this.save();
};

/**
 * @notice Instance method to check if account is active
 * @returns {boolean} True if account status is 'active'
 */
UserSchema.methods.isActive = function () {
  return this.status === 'active';
};

module.exports = mongoose.model('User', UserSchema);
