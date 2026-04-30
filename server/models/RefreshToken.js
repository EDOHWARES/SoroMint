const mongoose = require('mongoose');
const crypto = require('crypto');

const RefreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  revoked: {
    type: Boolean,
    default: false
  },
  revokedAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  userAgent: {
    type: String
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

RefreshTokenSchema.statics.hashToken = function(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

RefreshTokenSchema.statics.createRefreshToken = async function(user, options = {}) {
  const token = crypto.randomBytes(64).toString('hex');
  const hashedToken = this.hashToken(token);
  
  const expiresIn = options.expiresIn || process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
  const expiresAt = new Date();
  expiresIn.match(/(\d+)([dh])/);
  const value = parseInt(RegExp.$1);
  const unit = RegExp.$2;
  
  if (unit === 'd') {
    expiresAt.setDate(expiresAt.getDate() + value);
  } else if (unit === 'h') {
    expiresAt.setHours(expiresAt.getHours() + value);
  }
  
  const refreshToken = new this({
    user: user._id,
    token: hashedToken,
    expiresAt,
    userAgent: options.userAgent,
    ipAddress: options.ipAddress
  });
  
  await refreshToken.save();
  
  return {
    token,
    expiresAt: refreshToken.expiresAt,
    refreshTokenId: refreshToken._id
  };
};

RefreshTokenSchema.methods.revoke = async function() {
  this.revoked = true;
  this.revokedAt = new Date();
  return this.save();
};

RefreshTokenSchema.statics.verifyToken = async function(token, userId) {
  const hashedToken = this.hashToken(token);
  
  const refreshToken = await this.findOne({
    token: hashedToken,
    user: userId,
    revoked: false
  });
  
  if (!refreshToken) {
    return { valid: false, error: 'Invalid refresh token' };
  }
  
  if (refreshToken.expiresAt < new Date()) {
    return { valid: false, error: 'Refresh token expired' };
  }
  
  return { valid: true, refreshToken };
};

RefreshTokenSchema.statics.revokeToken = async function(token) {
  const hashedToken = this.hashToken(token);
  
  const refreshToken = await this.findOne({ token: hashedToken });
  if (refreshToken && !refreshToken.revoked) {
    await refreshToken.revoke();
    return true;
  }
  
  return false;
};

RefreshTokenSchema.statics.revokeAllUserTokens = async function(userId) {
  return this.updateMany(
    { user: userId, revoked: false },
    { revoked: true, revokedAt: new Date() }
  );
};

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);