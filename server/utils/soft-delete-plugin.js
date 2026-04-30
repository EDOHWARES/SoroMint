/**
 * @title Soft Delete Mongoose Plugin
 * @description Adds soft delete capabilities to Mongoose schemas
 * @notice Excludes soft-deleted documents from common queries
 */
module.exports = exports = function softDeletePlugin(schema, options) {
  schema.add({
    isArchived: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null
    }
  });

  const excludeArchived = function(next) {
    if (this.getOptions && this.getOptions().includeArchived === true) {
      return next();
    }
    // "this" is the query object
    this.where({ isArchived: { $ne: true } });
    next();
  };

  schema.pre('find', excludeArchived);
  schema.pre('findOne', excludeArchived);
  schema.pre('findOneAndUpdate', excludeArchived);
  schema.pre('countDocuments', excludeArchived);
  schema.pre('update', excludeArchived);
  schema.pre('updateOne', excludeArchived);
  schema.pre('updateMany', excludeArchived);

  // For aggregate
  schema.pre('aggregate', function(next) {
    if (this.options && this.options.includeArchived === true) {
      return next();
    }
    this.pipeline().unshift({ $match: { isArchived: { $ne: true } } });
    next();
  });

  schema.statics.softDelete = async function(conditions) {
    return this.updateMany(conditions, { $set: { isArchived: true, deletedAt: new Date() } });
  };
  
  schema.methods.softDelete = async function() {
    this.isArchived = true;
    this.deletedAt = new Date();
    return this.save();
  };

  schema.methods.restore = async function() {
    this.isArchived = false;
    this.deletedAt = null;
    return this.save();
  };
};
