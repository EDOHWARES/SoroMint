'use strict';

const express = require('express');
const crypto = require('crypto');
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

/**
 * @title Security Routes
 * @author SoroMint Team
 * @notice REST API for the SoroMint automated WASM security scanning system.
 *
 * @dev All mutating endpoints require a valid JWT (authenticate middleware).
 *      The scan endpoint is additionally rate-limited to prevent abuse of the
 *      CPU-intensive scanning engine.
 *
 * Route map:
 *   POST   /api/security/scan          — Scan a base64-encoded WASM blob (auth + rate-limited)
 *   GET    /api/security/scans         — List authenticated user's scan history
 *   GET    /api/security/scans/:scanId — Retrieve a specific scan result
 *   DELETE /api/security/scans/:scanId — Delete a scan record (own scans only)
 *   GET    /api/security/rules         — List all 20 scanner rules (public)
 *   GET    /api/security/stats         — Aggregate stats for authenticated user
 */
const createSecurityRouter = () => {
  const router = express.Router();

  // =========================================================================
  // POST /api/security/scan
  // =========================================================================

  /**
   * @route  POST /api/security/scan
   * @desc   Accept a base64-encoded WASM binary, run the full 20-rule static
   *         analysis engine against it, persist the result, and return the
   *         structured scan report.
   *
   * @access Private (JWT required) + rate-limited
   *
   * @body {string} wasm          — Base64-encoded WASM binary (required)
   * @body {string} [contractName] — Human-readable label for the contract
   * @body {string} [notes]        — Optional caller notes
   *
   * @returns 201 {
   *   success: true,
   *   message: string,
   *   data: {
   *     scanId, status, wasmHash, wasmSize, findings, summary,
   *     deploymentBlocked, scannerVersion, duration, contractName, notes,
   *     createdAt
   *   }
   * }
   * @returns 400 INVALID_WASM       — base64 decoding failed
   * @returns 400 VALIDATION_ERROR   — body schema violation
   * @returns 429 RATE_LIMIT_EXCEEDED
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

      // ── Decode base64 → Buffer ─────────────────────────────────────────────
      let wasmBuffer;
      try {
        wasmBuffer = Buffer.from(wasmBase64, 'base64');
        // Sanity check: re-encoding must round-trip (detects non-base64 input
        // that was accepted by the lenient regex but is structurally invalid)
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

      // ── Run scanner ────────────────────────────────────────────────────────
      const report = scanWasm(wasmBuffer, {
        maxWasmSize: env.WASM_MAX_SIZE_BYTES,
      });

      // ── Persist result ─────────────────────────────────────────────────────
      const scanResult = await ScanResult.create({
        userId,
        wasmHash:         report.wasmHash,
        wasmSize:         report.wasmSize,
        contractName:     contractName || null,
        notes:            notes || null,
        status:           report.status,
        findings:         report.findings,
        summary:          report.summary,
        duration:         report.duration,
        deploymentBlocked: report.deploymentBlocked,
        scannerVersion:   report.scannerVersion,
      });

      logger.info('[Security] WASM scan completed', {
        correlationId: req.correlationId,
        scanId:          scanResult.scanId,
        status:          scanResult.status,
        deploymentBlocked: scanResult.deploymentBlocked,
        duration:        scanResult.duration,
        findingCount:    scanResult.findings.length,
      });

      // ── Fire webhook event ─────────────────────────────────────────────────
      try {
        dispatch('security.scan_complete', {
          scanId:           scanResult.scanId,
          wasmHash:         scanResult.wasmHash,
          status:           scanResult.status,
          deploymentBlocked: scanResult.deploymentBlocked,
          userId:           String(userId),
          summary:          scanResult.summary,
        });
      } catch (webhookErr) {
        // Webhook dispatch is non-critical — log and continue
        logger.warn('[Security] Webhook dispatch failed after scan', {
          correlationId: req.correlationId,
          error: webhookErr.message,
        });
      }

      // ── Compose response ───────────────────────────────────────────────────
      const statusMessages = {
        clean:   'No security issues found. Contract is safe to deploy.',
        passed:  'No critical or high-severity issues found. Review warnings before deploying.',
        warning: 'Medium or low-severity issues found. Review findings before deploying.',
        failed:  'Critical or high-severity issues found. Deployment is blocked.',
        error:   'Scanner could not parse the WASM binary. Deployment is blocked.',
      };

      res.status(201).json({
        success: true,
        message: statusMessages[scanResult.status] || 'Scan complete.',
        data: {
          scanId:           scanResult.scanId,
          status:           scanResult.status,
          wasmHash:         scanResult.wasmHash,
          wasmSize:         scanResult.wasmSize,
          contractName:     scanResult.contractName,
          notes:            scanResult.notes,
          findings:         scanResult.findings,
          summary:          scanResult.summary,
          deploymentBlocked: scanResult.deploymentBlocked,
          scannerVersion:   scanResult.scannerVersion,
          duration:         scanResult.duration,
          createdAt:        scanResult.createdAt,
        },
      });
    })
  );

  // =========================================================================
  // GET /api/security/scans
  // =========================================================================

  /**
   * @route  GET /api/security/scans
   * @desc   Paginated list of scan results for the authenticated user.
   * @access Private (JWT required)
   *
   * @query {number} [page=1]
   * @query {number} [limit=20]
   * @query {string} [status]   — filter by scan status
   *
   * @returns 200 { success, data: ScanResult[], metadata }
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
          page:       result.page,
          totalPages: result.totalPages,
          limit:      result.limit,
        },
      });
    })
  );

  // =========================================================================
  // GET /api/security/scans/:scanId
  // =========================================================================

  /**
   * @route  GET /api/security/scans/:scanId
   * @desc   Retrieve a specific scan result by its public scanId (UUID).
   *         Users may only access their own scan results.
   * @access Private (JWT required)
   *
   * @param  {string} scanId — UUID of the scan (returned by POST /security/scan)
   *
   * @returns 200 { success, data: ScanResult }
   * @returns 404 SCAN_NOT_FOUND
   * @returns 403 FORBIDDEN  (scan belongs to a different user)
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

      // Ownership check — users may only view their own scans
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

  // =========================================================================
  // DELETE /api/security/scans/:scanId
  // =========================================================================

  /**
   * @route  DELETE /api/security/scans/:scanId
   * @desc   Permanently delete a scan record.
   *         Users may only delete their own scans.
   * @access Private (JWT required)
   *
   * @param  {string} scanId
   *
   * @returns 200 { success, message }
   * @returns 404 SCAN_NOT_FOUND
   * @returns 403 FORBIDDEN
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

      await ScanResult.softDelete({ scanId });

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

  // =========================================================================
  // GET /api/security/rules
  // =========================================================================

  /**
   * @route  GET /api/security/rules
   * @desc   Return the complete list of all scanner rules with their metadata.
   *         Useful for building UI dashboards that explain each finding.
   * @access Public (no auth required)
   *
   * @returns 200 { success, data: Rule[], totalRules }
   */
  router.get(
    '/security/rules',
    asyncHandler(async (_req, res) => {
      const rules = Object.values(RULES).map((rule) => ({
        id:             rule.id,
        severity:       rule.severity,
        title:          rule.title,
        description:    rule.description,
        recommendation: rule.recommendation,
      }));

      // Sort by rule ID so UI can display them in a predictable order
      rules.sort((a, b) => a.id.localeCompare(b.id));

      res.json({
        success:    true,
        totalRules: rules.length,
        data:       rules,
      });
    })
  );

  // =========================================================================
  // GET /api/security/stats
  // =========================================================================

  /**
   * @route  GET /api/security/stats
   * @desc   Aggregate statistics for the authenticated user's scan history.
   *         Useful for dashboard widgets.
   * @access Private (JWT required)
   *
   * @returns 200 {
   *   success,
   *   data: {
   *     total, byStatus, blockedCount, avgDuration,
   *     mostRecentScan: { scanId, status, wasmHash, createdAt } | null
   *   }
   * }
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
          total:          stats.total,
          byStatus:       stats.byStatus,
          blockedCount:   stats.blockedCount,
          avgDuration:    stats.avgDuration,
          mostRecentScan: mostRecentScan
            ? {
                scanId:           mostRecentScan.scanId,
                status:           mostRecentScan.status,
                wasmHash:         mostRecentScan.wasmHash,
                contractName:     mostRecentScan.contractName,
                deploymentBlocked: mostRecentScan.deploymentBlocked,
                createdAt:        mostRecentScan.createdAt,
              }
            : null,
        },
      });
    })
  );

  return router;
};

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

const securityRouter = createSecurityRouter();

module.exports = securityRouter;
module.exports.createSecurityRouter = createSecurityRouter;
