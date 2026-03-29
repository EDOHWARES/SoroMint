/**
 * @title Database Backup Service
 * @description Automated MongoDB backup using mongodump, uploaded to AWS S3.
 *   Runs on a configurable cron schedule and enforces a 30-day retention policy.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const cron = require("node-cron");
const { logger } = require("../utils/logger");

const BACKUP_DIR = path.join(__dirname, "../.backups");
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
 * Upload a local file to S3.
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} filePath
 * @returns {Promise<string>} S3 key of the uploaded object
 */
async function uploadToS3(s3, bucket, filePath) {
  const key = `backups/${path.basename(filePath)}`;
  const fileStream = fs.createReadStream(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: "application/gzip",
      ServerSideEncryption: "AES256",
    })
  );

  logger.info("Backup uploaded to S3", { bucket, key });
  return key;
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
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/" })
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
 * Full backup cycle: dump → upload → enforce retention → cleanup local file.
 */
async function runBackup() {
  const mongoUri = process.env.MONGO_URI;
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;

  if (!mongoUri || !bucket) {
    logger.error("Backup skipped: MONGO_URI or AWS_S3_BACKUP_BUCKET not set");
    return;
  }

  let archivePath;
  try {
    logger.info("Starting scheduled database backup");
    const s3 = buildS3Client();

    archivePath = runMongoDump(mongoUri);
    await uploadToS3(s3, bucket, archivePath);
    await enforceRetentionPolicy(s3, bucket);

    logger.info("Database backup completed successfully");
  } catch (err) {
    logger.error("Database backup failed", { error: err.message });
  } finally {
    // Always clean up the local archive
    if (archivePath && fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
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

module.exports = { scheduleBackups, runBackup };
