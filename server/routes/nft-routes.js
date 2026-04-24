const express = require('express');
const multer = require('multer');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { authenticate } = require('../middleware/auth');
const { tokenDeploymentRateLimiter } = require('../middleware/rate-limiter');
const { processNftZip } = require('../services/nft-service');
const { submitNftBatchOperations } = require('../services/stellar-service');
const NftCollection = require('../models/NftCollection');
const NftItem = require('../models/NftItem');
const DeploymentAudit = require('../models/DeploymentAudit');
const { logger } = require('../utils/logger');

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed' && !file.originalname.endsWith('.zip')) {
      return cb(new AppError('Only ZIP files are allowed', 400));
    }
    cb(null, true);
  }
});

/**
 * @route POST /api/nfts/collection/batch-mint
 * @description Upload a ZIP file containing an NFT collection and batch mint it.
 * @body {file} file - The ZIP file containing images and collection.json.
 * @body {string} name - Collection name.
 * @body {string} symbol - Collection symbol.
 * @body {string} contractId - Contract ID of the NFT collection on Stellar.
 * @body {string} sourcePublicKey - Stellar public key submitting the mint transactions.
 * @security JWT
 */
router.post(
  '/collection/batch-mint',
  authenticate,
  tokenDeploymentRateLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { name, symbol, contractId, sourcePublicKey } = req.body;
    const userId = req.user._id;

    if (!req.file) {
      throw new AppError('A ZIP file is required', 400);
    }
    if (!name || !symbol || !contractId || !sourcePublicKey) {
      throw new AppError('name, symbol, contractId, and sourcePublicKey are required', 400);
    }

    logger.info('NFT Batch Mint requested', { userId, contractId });

    // Ensure the collection doesn't already exist with this contractId
    let collection = await NftCollection.findOne({ contractId });
    if (!collection) {
      collection = new NftCollection({
        name,
        symbol,
        contractId,
        ownerPublicKey: sourcePublicKey,
      });
      await collection.save();
    } else if (collection.ownerPublicKey !== sourcePublicKey) {
      throw new AppError('Contract ID is already registered by a different owner', 403);
    }

    // Process the ZIP file
    let nftsToMint;
    try {
      nftsToMint = await processNftZip(req.file.buffer, collection);
    } catch (err) {
      throw new AppError(`Failed to process ZIP: ${err.message}`, 400);
    }

    // Submit batch operations
    let batchResult;
    try {
      batchResult = await submitNftBatchOperations(nftsToMint, contractId, sourcePublicKey);
    } catch (err) {
      await DeploymentAudit.create({
        userId,
        tokenName: `nft-batch(${nftsToMint.length})`,
        status: 'FAIL',
        errorMessage: err.message,
      });
      throw new AppError(`Blockchain transaction failed: ${err.message}`, 500);
    }

    if (!batchResult.success) {
       await DeploymentAudit.create({
        userId,
        tokenName: `nft-batch(${nftsToMint.length})`,
        status: 'FAIL',
        errorMessage: batchResult.error || 'Unknown simulation error',
      });
      return res.status(422).json(batchResult);
    }

    // Save successful NFTs to database
    const nftDocs = nftsToMint.map(nft => ({
      tokenId: nft.tokenId,
      uri: nft.uri,
      collectionId: collection._id,
      contractId,
      ownerPublicKey: sourcePublicKey,
    }));

    // Use insertMany (ignore duplicates if any)
    try {
      await NftItem.insertMany(nftDocs, { ordered: false });
    } catch (err) {
      // Ignore E11000 duplicate key error in case of retry
      if (err.code !== 11000) {
        logger.warn('Error saving some NFT items to DB', { error: err.message });
      }
    }

    collection.totalMinted += nftsToMint.length;
    await collection.save();

    await DeploymentAudit.create({
      userId,
      tokenName: `nft-batch(${nftsToMint.length})`,
      contractId,
      status: 'SUCCESS',
    });

    res.status(200).json({
      success: true,
      txHash: batchResult.txHash,
      mintedCount: nftsToMint.length,
    });
  })
);

module.exports = router;
