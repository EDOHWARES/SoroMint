const express = require('express');
const { Transform } = require('stream');
const DeploymentAudit = require('../models/DeploymentAudit');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');

const router = express.Router();

const CSV_HEADERS = 'id,tokenName,contractId,status,errorMessage,createdAt\n';

const escapeCSV = (val) => {
  if (val == null) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};

const rowToCSV = (doc) =>
  [doc._id, doc.tokenName, doc.contractId, doc.status, doc.errorMessage, doc.createdAt?.toISOString()]
    .map(escapeCSV)
    .join(',') + '\n';

router.get('/logs', authenticate, asyncHandler(async (req, res) => {
  const logs = await DeploymentAudit.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(logs);
}));

router.get('/logs/export', authenticate, asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const filter = { userId: req.user._id };

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (isNaN(fromDate)) throw new AppError('Invalid from date', 400, 'VALIDATION_ERROR');
      filter.createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (isNaN(toDate)) throw new AppError('Invalid to date', 400, 'VALIDATION_ERROR');
      filter.createdAt.$lte = toDate;
    }
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.write(CSV_HEADERS);

  const cursor = DeploymentAudit.find(filter).sort({ createdAt: -1 }).cursor();

  const transformer = new Transform({
    objectMode: true,
    transform(doc, _enc, cb) { cb(null, rowToCSV(doc)); },
  });

  transformer.on('error', (err) => res.destroy(err));
  cursor.pipe(transformer).pipe(res, { end: true });
}));

router.get('/admin/logs', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { status, userId, tokenName } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (userId) filter.userId = userId;
  if (tokenName) filter.tokenName = new RegExp(tokenName, 'i');

  const logs = await DeploymentAudit.find(filter)
    .populate('userId', 'publicKey username')
    .sort({ createdAt: -1 })
    .limit(100);

  res.json(logs);
}));

module.exports = router;
