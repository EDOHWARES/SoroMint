'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');
const { scanRateLimiter } = require('../middleware/rate-limiter');
const {
  validateScanRequest,
  validateListScansQuery,
} = require('../validators/security-validator');
const { scanWasm, RULES } = require('../services/wasm-scanner');
const ScanResult = require('../models/ScanResult');
const { dispatch } = require('../services/webhook-service');
const { getEnv } = require('../config/env-config');

const createSecurityRouter = () => {
  const router = express.Router();

  /**
   * @openapi
   * @route POST /api/security/scan
   * @name scanWasm
   * @description Scan a base64-encoded WASM binary with 20-rule static analysis engine
   * @tags Security
   * @security BearerAuth
   * @param {string} wasm - Base64-encoded WASM binary
   * @param {string} contractName - Human-readable label for the contract (optional)
   * @param {string} notes - Optional caller notes (optional)
   * @returns {object} 201 - Scan completed with findings
   * @returns {object} 400 - Invalid base64 WASM or validation error
   * @returns {object} 429 - Rate limit exceeded
   */
  router.post(
    '/security/scan',
    scanRateLimiter,
    authenticate,
    validateScanRequest,
    asyncHandler(async (req, res) => {
      const { wasm: wasmBase64, contractName, notes } = req.body;
      const userId = req.user._id;
      const env = getEnv();

      let wasmBuffer;
      try {
        wasmBuffer = Buffer.from(wasmBase64, 'base64');
        if (wasmBuffer.length === 0) {
          throw new Error('Decoded buffer is empty');
        }
      } catch (decodeErr) {
        throw new AppError(
          `Invalid base64 WASM data: ${decodeErr.message}`,
          400,
          'INVALID_WASM'
        );
      }

      logger.info('[Security] WASM scan initiated', {
        correlationId: req.correlationId,
        userId: String(userId),
        wasmSize: wasmBuffer.length,
        contractName: contractName || null,
      });

      const report = scanWasm(wasmBuffer, {
        maxWasmSize: env.WASM_MAX_SIZE_BYTES,
      });

      const scanResult = await ScanResult.create({
        userId,
        wasmHash: report.wasmHash,
        wasmSize: report.wasmSize,
        contractName: contractName || null,
        notes: notes || null,
        status: report.status,
        findings: report.findings,
        summary: report.summary,
        duration: report.duration,
        deploymentBlocked: report.deploymentBlocked,
        scannerVersion: report.scannerVersion,
      });

      logger.info('[Security] WASM scan completed', {
        correlationId: req.correlationId,
        scanId: scanResult.scanId,
        status: scanResult.status,
        deploymentBlocked: scanResult.deploymentBlocked,
        duration: scanResult.duration,
        findingCount: scanResult.findings.length,
      });

      try {
        dispatch('security.scan_complete', {
          scanId: scanResult.scanId,
          wasmHash: scanResult.wasmHash,
          status: scanResult.status,
          deploymentBlocked: scanResult.deploymentBlocked,
          userId: String(userId),
          summary: scanResult.summary,
        });
      } catch (webhookErr) {
        logger.warn('[Security] Webhook dispatch failed after scan', {
          correlationId: req.correlationId,
          error: webhookErr.message,
        });
      }

      const statusMessages = {
        clean: 'No security issues found. Contract is safe to deploy.',
        passed: 'No critical or high-severity issues found. Review warnings before deploying.',
        warning: 'Medium or low-severity issues found. Review findings before deploying.',
        failed: 'Critical or high-severity issues found. Deployment is blocked.',
        error: 'Scanner could not parse the WASM binary. Deployment is blocked.',
      };

      res.status(201).json({
        success: true,
        message: statusMessages[scanResult.status] || 'Scan complete.',
        data: {
          scanId: scanResult.scanId,
          status: scanResult.status,
          wasmHash: scanResult.wasmHash,
          wasmSize: scanResult.wasmSize,
          contractName: scanResult.contractName,
          notes: scanResult.notes,
          findings: scanResult.findings,
          summary: scanResult.summary,
          deploymentBlocked: scanResult.deploymentBlocked,
          scannerVersion: scanResult.scannerVersion,
          duration: scanResult.duration,
          createdAt: scanResult.createdAt,
        },
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/security/scans
   * @name listScans
   * @description Paginated list of scan results for the authenticated user
   * @tags Security
   * @security BearerAuth
   * @param {integer} page - Page number (optional, default: 1)
   * @param {integer} limit - Results per page (optional, default: 20)
   * @param {string} status - Filter by scan status (optional)
   * @returns {object} 200 - Scan results with pagination metadata
   */
  router.get(
    '/security/scans',
    authenticate,
    validateListScansQuery,
    asyncHandler(async (req, res) => {
      const { page, limit, status } = req.query;
      const userId = req.user._id;

      const result = await ScanResult.findByUser(userId, { page, limit, status });

      res.json({
        success: true,
        data: result.scans,
        metadata: {
          totalCount: result.totalCount,
          page: result.page,
          totalPages: result.totalPages,
          limit: result.limit,
        },
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/security/scans/{scanId}
   * @name getScan
   * @description Retrieve a specific scan result by its public scanId (UUID)
   * @tags Security
   * @security BearerAuth
   * @param {string} scanId - UUID of the scan (returned by POST /security/scan)
   * @returns {object} 200 - Scan result
   * @returns {object} 404 - Scan not found
   * @returns {object} 403 - Scan belongs to a different user
   */
  router.get(
    '/security/scans/:scanId',
    authenticate,
    asyncHandler(async (req, res) => {
      const { scanId } = req.params;
      const userId = req.user._id;

      const scan = await ScanResult.findOne({ scanId }).lean();

      if (!scan) {
        throw new AppError(
          `Scan result not found: ${scanId}`,
          404,
          'SCAN_NOT_FOUND'
        );
      }

      if (String(scan.userId) !== String(userId)) {
        throw new AppError(
          'You do not have permission to view this scan result.',
          403,
          'FORBIDDEN'
        );
      }

      res.json({ success: true, data: scan });
    })
  );

  /**
   * @openapi
   * @route DELETE /api/security/scans/{scanId}
   * @name deleteScan
   * @description Permanently delete a scan record (own scans only)
   * @tags Security
   * @security BearerAuth
   * @param {string} scanId - Scan ID to delete
   * @returns {object} 200 - Scan deleted successfully
   * @returns {object} 404 - Scan not found
   * @returns {object} 403 - Not the owner
   */
  router.delete(
    '/security/scans/:scanId',
    authenticate,
    asyncHandler(async (req, res) => {
      const { scanId } = req.params;
      const userId = req.user._id;

      const scan = await ScanResult.findOne({ scanId });

      if (!scan) {
        throw new AppError(
          `Scan result not found: ${scanId}`,
          404,
          'SCAN_NOT_FOUND'
        );
      }

      if (String(scan.userId) !== String(userId)) {
        throw new AppError(
          'You do not have permission to delete this scan result.',
          403,
          'FORBIDDEN'
        );
      }

      await ScanResult.deleteOne({ scanId });

      logger.info('[Security] Scan result deleted', {
        correlationId: req.correlationId,
        scanId,
        userId: String(userId),
      });

      res.json({
        success: true,
        message: `Scan result ${scanId} has been deleted.`,
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/security/rules
   * @name getSecurityRules
   * @description Return the complete list of all 20 scanner rules with metadata
   * @tags Security
   * @returns {object} 200 - List of scanner rules
   */
  router.get(
    '/security/rules',
    asyncHandler(async (_req, res) => {
      const rules = Object.values(RULES).map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation,
      }));

      rules.sort((a, b) => a.id.localeCompare(b.id));

      res.json({
        success: true,
        totalRules: rules.length,
        data: rules,
      });
    })
  );

  /**
   * @openapi
   * @route GET /api/security/stats
   * @name getSecurityStats
   * @description Aggregate statistics for the authenticated user's scan history
   * @tags Security
   * @security BearerAuth
   * @returns {object} 200 - User scan statistics
   */
  router.get(
    '/security/stats',
    authenticate,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;

      const [stats, mostRecentScan] = await Promise.all([
        ScanResult.getStats(userId),
        ScanResult.findOne({ userId })
          .sort({ createdAt: -1 })
          .select('scanId status wasmHash contractName createdAt deploymentBlocked')
          .lean(),
      ]);

      res.json({
        success: true,
        data: {
          total: stats.total,
          byStatus: stats.byStatus,
          blockedCount: stats.blockedCount,
          avgDuration: stats.avgDuration,
          mostRecentScan: mostRecentScan
            ? {
                scanId: mostRecentScan.scanId,
                status: mostRecentScan.status,
                wasmHash: mostRecentScan.wasmHash,
                contractName: mostRecentScan.contractName,
                deploymentBlocked: mostRecentScan.deploymentBlocked,
                createdAt: mostRecentScan.createdAt,
              }
            : null,
        },
      });
    })
  );

  return router;
};

const securityRouter = createSecurityRouter();

module.exports = securityRouter;
module.exports.createSecurityRouter = createSecurityRouter;
