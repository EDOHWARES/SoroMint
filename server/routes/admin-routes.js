const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/error-handler');

/**
 * @title Admin Data Management Routes
 * @description Provides tools for viewing and restoring archived (soft-deleted) data.
 */

// Restore an archived record
router.post('/restore/:modelName/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { modelName, id } = req.params;
    const Model = mongoose.models[modelName];
    
    if (!Model) {
      throw new AppError(`Model ${modelName} not found`, 404);
    }
    
    const doc = await Model.findOne({ _id: id }).setOptions({ includeArchived: true });
    if (!doc) {
      throw new AppError(`Record not found`, 404);
    }
    
    if (!doc.isArchived) {
      return res.status(400).json({ status: 'error', message: 'Record is not archived' });
    }
    
    await doc.restore();
    
    res.json({
      status: 'success',
      message: `${modelName} record restored successfully`,
      data: doc
    });
  } catch (error) {
    next(error);
  }
});

// List archived records for a given model
router.get('/archived/:modelName', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { modelName } = req.params;
    const Model = mongoose.models[modelName];
    
    if (!Model) {
      throw new AppError(`Model ${modelName} not found`, 404);
    }
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const records = await Model.find({ isArchived: true })
      .setOptions({ includeArchived: true })
      .skip(skip)
      .limit(limit)
      .sort({ deletedAt: -1 });
      
    const total = await Model.countDocuments({ isArchived: true }).setOptions({ includeArchived: true });
    
    res.json({
      status: 'success',
      data: records,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
