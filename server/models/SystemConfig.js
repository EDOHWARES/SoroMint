const mongoose = require('mongoose');

/**
 * @title System Configuration Model
 * @description Stores global backend settings managed by administrators
 */

const SystemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'platform',
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

SystemConfigSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('SystemConfig', SystemConfigSchema);
