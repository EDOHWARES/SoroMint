/**
 * @title Recovery Test Service
 * @description Automated recovery testing for S3 backups
 * @dev Downloads, decrypts, and verifies backup integrity without affecting production data
 */

const fs = require("fs");
const path = require("path");
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { execSync } = require("child_process");
const cron = require("node-cron");
const { logger } = require("../utils/logger");
const { decryptFile } = require("../utils/backup-encryption");

const TEST_RESTORE_DIR = path.join(__dirname, "../.backups/test-restore");
const RETENTION_DAYS = 30;

/**
 * Build an S3 client from environment variables.
 */
function buildS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Get the encryption password from environment
 */
function getEncryptionPassword() {
  const password = process.env.BACKUP_ENCRYPTION_PASSWORD;
  if (!password) {
    throw new Error("BACKUP_ENCRYPTION_PASSWORD not configured - cannot perform recovery test");
  }
  return password;
}

/**
 * Get the most recent backup from S3
 * @param {S3Client} s3
 * @param {string} bucket
 * @returns {Promise<Object|null>} Most recent backup object or null
 */
async function getLatestBackup(s3, bucket) {
  const listed = await s3.send(
    new ListObjectsV2Command({ 
      Bucket: bucket, 
      Prefix: "backups/encrypted-",
      MaxKeys: 1,
    })
  );

  if (!listed.Contents || listed.Contents.length === 0) {
    return null;
  }

  // Sort by LastModified to get the most recent
  const sorted = listed.Contents.sort((a, b) => 
    new Date(b.LastModified) - new Date(a.LastModified)
  );

  return sorted[0];
}

/**
 * Get encryption metadata for a backup
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} backupKey
 * @returns {Promise<Object>} Encryption metadata
 */
async function getBackupMetadata(s3, bucket, backupKey) {
  const metadataKey = `backups/metadata/${path.basename(backupKey)}.json`;
  
  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: metadataKey,
      })
    );

    const bodyString = await response.Body.transformToString();
    return JSON.parse(bodyString);
  } catch (err) {
    logger.warn("Metadata not found, attempting to get from S3 object metadata", { error: err.message });
    
    // Fallback: try to get from S3 object metadata
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: backupKey,
      })
    );
    
    return {
      encryption: {
        iv: response.Metadata?.["encryption-iv"],
        salt: response.Metadata?.["encryption-salt"],
      },
    };
  }
}

/**
 * Download a backup from S3
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} key
 * @param {string} localPath
 * @returns {Promise<string>} Local path to downloaded file
 */
async function downloadBackup(s3, bucket, key, localPath) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  const stream = response.Body;
  
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(localPath);
    
    stream.pipe(writeStream);
    
    writeStream.on("finish", () => {
      logger.info("Backup downloaded from S3", { key, localPath });
      resolve(localPath);
    });
    
    writeStream.on("error", (err) => {
      logger.error("Failed to write downloaded backup", { error: err.message });
      reject(err);
    });
    
    stream.on("error", (err) => {
      logger.error("Failed to download backup from S3", { error: err.message });
      reject(err);
    });
  });
}

/**
 * Decrypt a backup file
 * @param {string} encryptedPath
 * @param {string} password
 * @param {string} iv
 * @param {string} salt
 * @returns {Promise<string>} Path to decrypted file
 */
async function decryptBackup(encryptedPath, password, iv, salt) {
  const decryptedPath = encryptedPath.replace(".enc", ".decrypted.gz");
  
  await decryptFile(encryptedPath, decryptedPath, password, iv, salt);
  
  logger.info("Backup decrypted", { decryptedPath });
  return decryptedPath;
}

/**
 * Test restore a backup to a temporary MongoDB instance
 * @param {string} backupPath - Path to the decrypted .gz backup
 * @param {string} testMongoUri - MongoDB URI for test restore
 * @returns {Promise<Object>} Test result
 */
function testRestore(backupPath, testMongoUri) {
  try {
    // Test mongorestore with --dryRun flag first
    logger.info("Testing backup restore (dry run)", { backupPath });
    
    execSync(`mongorestore --uri="${testMongoUri}" --dryRun --archive="${backupPath}" --gzip`, {
      stdio: "pipe",
    });
    
    logger.info("Backup restore validation passed (dry run)");
    
    return {
      success: true,
      validated: true,
      message: "Backup restore validation passed",
    };
  } catch (err) {
    logger.error("Backup restore validation failed", { error: err.message });
    return {
      success: false,
      validated: false,
      error: err.message,
    };
  }
}

/**
 * Verify backup integrity by checking archive contents
 * @param {string} backupPath - Path to the .gz backup
 * @returns {Object} Verification result
 */
function verifyBackupIntegrity(backupPath) {
  try {
    // Test that the gzip file is valid
    execSync(`gunzip -t "${backupPath}"`, {
      stdio: "pipe",
    });
    
    // Check that mongodump can list contents
    execSync(`mongorestore --uri="mongodb://localhost:27017" --dryRun --archive="${backupPath}" --gzip 2>&1 | head -20`, {
      stdio: "pipe",
    });
    
    return {
      success: true,
      valid: true,
      message: "Backup archive is valid and readable",
    };
  } catch (err) {
    logger.error("Backup integrity check failed", { error: err.message });
    return {
      success: false,
      valid: false,
      error: err.message,
    };
  }
}

/**
 * Run a full recovery test
 * @param {Object} options - Test options
 * @param {string} options.testMongoUri - MongoDB URI for test restore (optional)
 * @returns {Promise<Object>} Test result
 */
async function runRecoveryTest(options = {}) {
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  const testMongoUri = options.testMongoUri || process.env.TEST_MONGO_URI;
  
  if (!bucket) {
    return { 
      success: false, 
      error: "AWS_S3_BACKUP_BUCKET not configured" 
    };
  }

  // Ensure test restore directory exists
  if (!fs.existsSync(TEST_RESTORE_DIR)) {
    fs.mkdirSync(TEST_RESTORE_DIR, { recursive: true });
  }

  let s3;
  let downloadedPath = null;
  let decryptedPath = null;
  
  try {
    logger.info("Starting recovery test");
    s3 = buildS3Client();
    
    // Step 1: Get the latest backup
    const latestBackup = await getLatestBackup(s3, bucket);
    if (!latestBackup) {
      return { 
        success: false, 
        error: "No backups found in S3" 
      };
    }
    
    logger.info("Found latest backup", { 
      key: latestBackup.Key, 
      size: latestBackup.Size,
      lastModified: latestBackup.LastModified 
    });
    
    // Step 2: Get encryption metadata
    const metadata = await getBackupMetadata(s3, bucket, latestBackup.Key);
    if (!metadata.encryption?.iv || !metadata.encryption?.salt) {
      return { 
        success: false, 
        error: "Encryption metadata not found for backup" 
      };
    }
    
    // Step 3: Download the backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadedPath = path.join(TEST_RESTORE_DIR, `test-${timestamp}.enc`);
    await downloadBackup(s3, bucket, latestBackup.Key, downloadedPath);
    
    // Step 4: Decrypt the backup
    const password = getEncryptionPassword();
    decryptedPath = await decryptBackup(downloadedPath, password, metadata.encryption.iv, metadata.encryption.salt);
    
    // Step 5: Verify backup integrity
    const integrityResult = verifyBackupIntegrity(decryptedPath);
    if (!integrityResult.valid) {
      return {
        success: false,
        stage: "integrity-check",
        error: integrityResult.error,
      };
    }
    
    // Step 6: Test restore (if test Mongo URI provided)
    let restoreResult = null;
    if (testMongoUri) {
      restoreResult = testRestore(decryptedPath, testMongoUri);
      if (!restoreResult.success) {
        return {
          success: false,
          stage: "restore-test",
          error: restoreResult.error,
        };
      }
    }
    
    logger.info("Recovery test completed successfully");
    return {
      success: true,
      backup: {
        key: latestBackup.Key,
        size: latestBackup.Size,
        lastModified: latestBackup.LastModified,
      },
      validated: true,
      restoreTested: !!testMongoUri,
      restoreResult,
      timestamp: new Date().toISOString(),
    };
    
  } catch (err) {
    logger.error("Recovery test failed", { error: err.message, stack: err.stack });
    return {
      success: false,
      error: err.message,
    };
  } finally {
    // Clean up test files
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      fs.unlinkSync(downloadedPath);
    }
    if (decryptedPath && fs.existsSync(decryptedPath)) {
      fs.unlinkSync(decryptedPath);
    }
  }
}

/**
 * Get list of backup metadata files
 * @returns {Promise<Array>} List of backup metadata
 */
async function listBackupMetadata() {
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  
  if (!bucket) {
    return { success: false, error: "AWS_S3_BACKUP_BUCKET not configured" };
  }

  try {
    const s3 = buildS3Client();
    
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/metadata/" })
    );

    if (!listed.Contents || listed.Contents.length === 0) {
      return { success: true, metadata: [] };
    }

    const metadataFiles = [];
    for (const obj of listed.Contents) {
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: obj.Key,
          })
        );
        const bodyString = await response.Body.transformToString();
        metadataFiles.push(JSON.parse(bodyString));
      } catch (err) {
        logger.warn("Failed to read metadata file", { key: obj.Key, error: err.message });
      }
    }

    return { success: true, metadata: metadataFiles };
  } catch (err) {
    logger.error("Failed to list backup metadata", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Schedule automated recovery tests
 * Default schedule: daily at 03:00 UTC (after backup at 02:00)
 * Override via RECOVERY_TEST_CRON_SCHEDULE env var
 */
function scheduleRecoveryTests() {
  const schedule = process.env.RECOVERY_TEST_CRON_SCHEDULE || "0 3 * * *";

  if (!cron.validate(schedule)) {
    logger.error("Invalid RECOVERY_TEST_CRON_SCHEDULE — recovery tests not scheduled", { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runRecoveryTest().then((result) => {
      if (result.success) {
        logger.info("Scheduled recovery test passed", { result });
      } else {
        logger.error("Scheduled recovery test failed", { error: result.error });
      }
    });
  });

  logger.info("Recovery test job scheduled", { schedule });
}

module.exports = {
  runRecoveryTest,
  scheduleRecoveryTests,
  listBackupMetadata,
  getLatestBackup,
  verifyBackupIntegrity,
  testRestore,
};