'use strict';

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed' && !file.originalname.endsWith('.zip')) {
      return cb(new AppError('Only ZIP files are allowed', 400));
    }
    cb(null, true);
  }
});

/**
 * @openapi
 * @route POST /api/nfts/collection/batch-mint
 * @name batchMintNftCollection
 * @description Upload a ZIP file containing an NFT collection and batch mint all items
 * @tags NFT
 * @security BearerAuth
 * @param {file} file - ZIP file containing images and collection.json
 * @param {string} name - Collection name
 * @param {string} symbol - Collection symbol
 * @param {string} contractId - NFT contract ID on Stellar (C...)
 * @param {string} sourcePublicKey - Stellar public key submitting mint transactions (G...)
 * @returns {object} 200 - Batch mint completed
 * @returns {object} 400 - ZIP file required or processing failed
 * @returns {object} 403 - Contract ID already registered by different owner
 * @returns {object} 422 - Blockchain transaction failed
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

    let nftsToMint;
    try {
      nftsToMint = await processNftZip(req.file.buffer, collection);
    } catch (err) {
      throw new AppError(`Failed to process ZIP: ${err.message}`, 400);
    }

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

    const nftDocs = nftsToMint.map(nft => ({
      tokenId: nft.tokenId,
      uri: nft.uri,
      collectionId: collection._id,
      contractId,
      ownerPublicKey: sourcePublicKey,
    }));

    try {
      await NftItem.insertMany(nftDocs, { ordered: false });
    } catch (err) {
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
