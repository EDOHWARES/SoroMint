/**
 * @title Database Backup Service
 * @description Automated MongoDB backup with encryption using AES-256-GCM,
 *   uploaded to AWS S3. Runs on a configurable cron schedule and enforces
 *   a 30-day retention policy.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const cron = require("node-cron");
const { logger } = require("../utils/logger");
const { encryptFile, decryptFile, generatePassword } = require("../utils/backup-encryption");

const BACKUP_DIR = path.join(__dirname, "../.backups");
const RETENTION_DAYS = 30;
const ENCRYPTION_METADATA_KEY = "backups/metadata/";

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
 * Get the encryption password from environment or generate one
 */
function getEncryptionPassword() {
  let password = process.env.BACKUP_ENCRYPTION_PASSWORD;
  
  if (!password) {
    logger.warn("BACKUP_ENCRYPTION_PASSWORD not set, generating a random one");
    password = generatePassword(32);
    logger.info("Generated random encryption password - SAVE THIS PASSWORD!", {
      warning: "Store this password securely - backups cannot be restored without it"
    });
  }
  
  return password;
}

/**
 * Run mongodump and return the path to the resulting archive.
 * @param {string} mongoUri
 * @returns {string} absolute path to the .gz archive
 */
function runMongoDump(mongoUri) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(BACKUP_DIR, `backup-${timestamp}.gz`);

  execSync(`mongodump --uri="${mongoUri}" --archive="${archivePath}" --gzip`, {
    stdio: "pipe",
  });

  logger.info("mongodump completed", { archivePath });
  return archivePath;
}

/**
 * Encrypts a backup file using AES-256-GCM
 * @param {string} filePath - Path to the backup file
 * @param {string} password - Encryption password
 * @returns {Object} Object containing encrypted file path and metadata
 */
async function encryptBackup(filePath, password) {
  const encryptedPath = filePath + ".enc";
  
  const { iv, salt } = await encryptFile(filePath, encryptedPath, password);
  
  return {
    encryptedPath,
    iv,
    salt,
  };
}

/**
 * Upload a local file to S3 with metadata.
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} filePath
 * @param {Object} metadata - Additional metadata to store with the backup
 * @returns {Promise<string>} S3 key of the uploaded object
 */
async function uploadToS3(s3, bucket, filePath, metadata = {}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `backups/encrypted-${timestamp}.enc`;
  const fileStream = fs.createReadStream(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: "application/octet-stream",
      ServerSideEncryption: "AES256",
      Metadata: {
        "encryption-iv": metadata.iv || "",
        "encryption-salt": metadata.salt || "",
        "backup-timestamp": metadata.timestamp || new Date().toISOString(),
        "encrypted": "true",
      },
    })
  );

  logger.info("Encrypted backup uploaded to S3", { bucket, key });
  return key;
}

/**
 * Upload encryption metadata to S3 for recovery purposes
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} backupKey - S3 key of the backup
 * @param {Object} metadata - Encryption metadata (iv, salt)
 */
async function uploadMetadata(s3, bucket, backupKey, metadata) {
  const metadataKey = `backups/metadata/${path.basename(backupKey)}.json`;
  
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: metadataKey,
      Body: JSON.stringify({
        backupKey,
        timestamp: new Date().toISOString(),
        encryption: {
          iv: metadata.iv,
          salt: metadata.salt,
          algorithm: "AES-256-GCM",
        },
      }),
      ContentType: "application/json",
    })
  );

  logger.info("Backup metadata uploaded", { metadataKey });
}

/**
 * Delete S3 backup objects older than RETENTION_DAYS.
 * @param {S3Client} s3
 * @param {string} bucket
 */
async function enforceRetentionPolicy(s3, bucket) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/encrypted-" })
  );

  if (!listed.Contents || listed.Contents.length === 0) return;

  const toDelete = listed.Contents.filter(
    (obj) => obj.LastModified && obj.LastModified < cutoff
  ).map((obj) => ({ Key: obj.Key }));

  if (toDelete.length === 0) {
    logger.info("Retention policy: no expired backups found");
    return;
  }

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: toDelete },
    })
  );

  logger.info("Retention policy enforced", { deletedCount: toDelete.length, cutoff });
}

/**
 * Full backup cycle: dump → encrypt → upload → enforce retention → cleanup local files.
 */
async function runBackup() {
  const mongoUri = process.env.MONGO_URI;
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;

  if (!mongoUri || !bucket) {
    logger.error("Backup skipped: MONGO_URI or AWS_S3_BACKUP_BUCKET not set");
    return { success: false, error: "Missing MONGO_URI or AWS_S3_BACKUP_BUCKET" };
  }

  let archivePath;
  let encryptedPath;
  const password = getEncryptionPassword();
  
  try {
    logger.info("Starting scheduled database backup with encryption");
    const s3 = buildS3Client();

    // Step 1: Create MongoDB dump
    archivePath = runMongoDump(mongoUri);
    
    // Step 2: Encrypt the backup
    const { encryptedPath: encPath, iv, salt } = await encryptBackup(archivePath, password);
    encryptedPath = encPath;
    
    // Step 3: Upload encrypted backup to S3
    const backupKey = await uploadToS3(s3, bucket, encryptedPath, { iv, salt });
    
    // Step 4: Upload metadata for recovery
    await uploadMetadata(s3, bucket, backupKey, { iv, salt });
    
    // Step 5: Enforce retention policy
    await enforceRetentionPolicy(s3, bucket);

    logger.info("Encrypted database backup completed successfully");
    return { 
      success: true, 
      timestamp: new Date().toISOString(),
      bucket,
      key: backupKey,
      encrypted: true,
    };
  } catch (err) {
    logger.error("Database backup failed", { error: err.message, stack: err.stack });
    return { success: false, error: err.message };
  } finally {
    // Always clean up local files
    if (archivePath && fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
    if (encryptedPath && fs.existsSync(encryptedPath)) {
      fs.unlinkSync(encryptedPath);
    }
  }
}

/**
 * Get list of available backups from S3
 * @returns {Promise<Array>} List of backup metadata
 */
async function listBackups() {
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  
  if (!bucket) {
    return { success: false, error: "AWS_S3_BACKUP_BUCKET not configured" };
  }

  try {
    const s3 = buildS3Client();
    
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/encrypted-" })
    );

    if (!listed.Contents || listed.Contents.length === 0) {
      return { success: true, backups: [] };
    }

    const backups = listed.Contents.map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      etag: obj.ETag,
    }));

    return { success: true, backups };
  } catch (err) {
    logger.error("Failed to list backups", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Register the backup cron job.
 * Default schedule: daily at 02:00 UTC.
 * Override via BACKUP_CRON_SCHEDULE env var (standard cron syntax).
 */
function scheduleBackups() {
  const schedule = process.env.BACKUP_CRON_SCHEDULE || "0 2 * * *";

  if (!cron.validate(schedule)) {
    logger.error("Invalid BACKUP_CRON_SCHEDULE — backups not scheduled", { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runBackup().catch((err) =>
      logger.error("Unhandled error in backup job", { error: err.message })
    );
  });

  logger.info("Database backup job scheduled", { schedule });
}

module.exports = { 
  scheduleBackups, 
  runBackup,
  listBackups,
  getEncryptionPassword,
  encryptBackup,
  uploadToS3,
  enforceRetentionPolicy,
};
