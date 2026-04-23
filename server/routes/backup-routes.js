/**
 * @title Backup Routes
 * @description API routes for backup management and recovery testing
 */

const express = require("express");
const router = express.Router();
const { runBackup, listBackups } = require("../services/backup-service");
const { runRecoveryTest, listBackupMetadata } = require("../services/recovery-test-service");
const { logger } = require("../utils/logger");

/**
 * POST /api/backups/trigger
 * Manually trigger a backup
 */
router.post("/trigger", async (req, res) => {
  try {
    logger.info("Manual backup triggered via API");
    
    const result = await runBackup();
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Backup completed successfully",
        data: result,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Backup failed",
        error: result.error,
      });
    }
  } catch (err) {
    logger.error("Backup trigger failed", { error: err.message });
    res.status(500).json({
      success: false,
      message: "Backup trigger failed",
      error: err.message,
    });
  }
});

/**
 * GET /api/backups
 * List all available backups
 */
router.get("/", async (req, res) => {
  try {
    const result = await listBackups();
    
    if (result.success) {
      res.status(200).json({
        success: true,
        backups: result.backups,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to list backups",
        error: result.error,
      });
    }
  } catch (err) {
    logger.error("List backups failed", { error: err.message });
    res.status(500).json({
      success: false,
      message: "Failed to list backups",
      error: err.message,
    });
  }
});

/**
 * GET /api/backups/metadata
 * List backup metadata
 */
router.get("/metadata", async (req, res) => {
  try {
    const result = await listBackupMetadata();
    
    if (result.success) {
      res.status(200).json({
        success: true,
        metadata: result.metadata,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to list backup metadata",
        error: result.error,
      });
    }
  } catch (err) {
    logger.error("List backup metadata failed", { error: err.message });
    res.status(500).json({
      success: false,
      message: "Failed to list backup metadata",
      error: err.message,
    });
  }
});

/**
 * POST /api/backups/test-recovery
 * Trigger a recovery test
 */
router.post("/test-recovery", async (req, res) => {
  try {
    logger.info("Manual recovery test triggered via API");
    
    const testMongoUri = req.body.testMongoUri || process.env.TEST_MONGO_URI;
    
    const result = await runRecoveryTest({ testMongoUri });
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Recovery test completed successfully",
        data: result,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Recovery test failed",
        error: result.error,
        stage: result.stage,
      });
    }
  } catch (err) {
    logger.error("Recovery test failed", { error: err.message });
    res.status(500).json({
      success: false,
      message: "Recovery test failed",
      error: err.message,
    });
  }
});

/**
 * GET /api/backups/status
 * Get backup system status
 */
router.get("/status", async (req, res) => {
  try {
    const bucket = process.env.AWS_S3_BACKUP_BUCKET;
    const encryptionPassword = process.env.BACKUP_ENCRYPTION_PASSWORD;
    const backupSchedule = process.env.BACKUP_CRON_SCHEDULE || "0 2 * * *";
    const recoverySchedule = process.env.RECOVERY_TEST_CRON_SCHEDULE || "0 3 * * *";
    
    res.status(200).json({
      success: true,
      status: {
        configured: !!bucket,
        bucket: bucket || null,
        encryptionEnabled: !!encryptionPassword,
        backupSchedule,
        recoveryTestSchedule: recoverySchedule,
        features: {
          encryption: "AES-256-GCM",
          retentionDays: 30,
          automatedTesting: true,
        },
      },
    });
  } catch (err) {
    logger.error("Get backup status failed", { error: err.message });
    res.status(500).json({
      success: false,
      message: "Failed to get backup status",
      error: err.message,
    });
  }
});

module.exports = router;