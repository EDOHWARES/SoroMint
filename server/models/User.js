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
    required: [true, 'Public key is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function (value) {
        // Basic validation for Stellar public key format
        // G followed by 55 base32 characters (A-Z, 2-7)
        return /^G[A-Z2-7]{55}$/.test(value);
      },
      message: 'Invalid Stellar public key format. Must start with G and be 56 characters long.'
    }
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
  }
}, {
  timestamps: true
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
