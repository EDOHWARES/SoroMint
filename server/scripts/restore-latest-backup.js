#!/usr/bin/env node
/**
 * Restore the latest encrypted MongoDB backup from S3.
 *
 * Usage:
 *   node scripts/restore-latest-backup.js --target mongodb://localhost:27017/restore_db
 *   node scripts/restore-latest-backup.js --target mongodb://localhost:27017/restore_db --backup-key backups/encrypted-2026-04-01T02-00-00-000Z.enc
 *   node scripts/restore-latest-backup.js --help
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');
const { decryptFile } = require('../utils/backup-encryption');
const { logger } = require('../utils/logger');

const ENV_PATH = path.resolve(__dirname, '../.env');
if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH });
} else {
  dotenv.config();
}

const BACKUP_DIR = path.join(__dirname, '../.backups/restore');
const DEFAULT_REGION = process.env.AWS_REGION || 'us-east-1';

function printHelp() {
  console.log(`Restore the latest MongoDB backup from S3 and restore it to a target database.

Usage:
  node scripts/restore-latest-backup.js --target <MONGO_URI> [--backup-key <S3_KEY>] [--dry-run]

Options:
  --target      Target MongoDB URI to restore backups into
  --backup-key  Optional S3 key for a specific encrypted backup
  --dry-run     Validate restore operation without writing data
  --help, -h    Show this help message
`);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

async function getLatestBackup(s3, bucket) {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: 'backups/encrypted-', MaxKeys: 100 })
  );

  if (!listed.Contents || listed.Contents.length === 0) {
    return null;
  }

  return listed.Contents.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0];
}

async function getBackupMetadata(s3, bucket, backupKey) {
  const metadataKey = `backups/metadata/${path.basename(backupKey)}.json`;

  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: metadataKey })
    );
    const bodyString = await response.Body.transformToString();
    return JSON.parse(bodyString);
  } catch (err) {
    logger.warn('Backup metadata not available, attempting to use object metadata', {
      key: backupKey,
      error: err.message,
    });

    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: backupKey })
    );

    return {
      encryption: {
        iv: response.Metadata?.['encryption-iv'],
        salt: response.Metadata?.['encryption-salt'],
      },
    };
  }
}

async function downloadBackup(s3, bucket, key, destinationPath) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(destinationPath);
    response.Body.pipe(writeStream);

    writeStream.on('finish', () => {
      logger.info('Downloaded backup from S3', { key, destinationPath });
      resolve(destinationPath);
    });

    writeStream.on('error', reject);
    response.Body.on('error', reject);
  });
}

function restoreArchive(decryptedPath, targetUri, dryRun) {
  const command = [
    'mongorestore',
    `--uri="${targetUri}"`,
    `--archive="${decryptedPath}"`,
    '--gzip',
  ];

  if (dryRun) {
    command.push('--dryRun');
  }

  logger.info('Restoring backup archive', { decryptedPath, targetUri, dryRun });
  execSync(command.join(' '), { stdio: 'inherit' });
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const targetUri = getArg('--target') || process.env.RESTORE_MONGO_URI;
  const backupKey = getArg('--backup-key');
  const dryRun = process.argv.includes('--dry-run');
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  const password = process.env.BACKUP_ENCRYPTION_PASSWORD;

  if (!bucket) {
    console.error('ERROR: AWS_S3_BACKUP_BUCKET is not configured in environment.');
    process.exit(1);
  }

  if (!password) {
    console.error('ERROR: BACKUP_ENCRYPTION_PASSWORD is not configured in environment.');
    process.exit(1);
  }

  if (!targetUri) {
    console.error('ERROR: Restore target MongoDB URI is required. Use --target or RESTORE_MONGO_URI.');
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const s3 = new S3Client({ region: DEFAULT_REGION });
  let selectedBackup = { Key: backupKey };

  try {
    if (!backupKey) {
      selectedBackup = await getLatestBackup(s3, bucket);
      if (!selectedBackup) {
        throw new Error('No backups found in S3 bucket');
      }
    }

    logger.info('Restoring backup', { key: selectedBackup.Key });

    const metadata = await getBackupMetadata(s3, bucket, selectedBackup.Key);
    if (!metadata.encryption?.iv || !metadata.encryption?.salt) {
      throw new Error('Unable to retrieve encryption metadata for backup');
    }

    const encryptedPath = path.join(BACKUP_DIR, path.basename(selectedBackup.Key));
    await downloadBackup(s3, bucket, selectedBackup.Key, encryptedPath);

    const decryptedPath = encryptedPath.replace('.enc', '.decrypted.gz');
    await decryptFile(encryptedPath, decryptedPath, password, metadata.encryption.iv, metadata.encryption.salt);

    restoreArchive(decryptedPath, targetUri, dryRun);
    logger.info('Backup restore completed successfully', { targetUri, backupKey: selectedBackup.Key });

    console.log(`Restore completed successfully${dryRun ? ' (dry run)' : ''}.`);
  } catch (err) {
    console.error('Backup restore failed:', err.message);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error while restoring backup:', err.message);
  process.exit(1);
});
