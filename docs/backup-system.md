# Scheduled Encrypted Backups with Automated Recovery Testing

## Overview

This document describes the implementation of a robust backup system for SoroMint that provides:

- **AES-256-GCM Encryption**: All backups are encrypted before upload to S3
- **Scheduled Backups**: Automated daily backups via cron jobs
- **Automated Recovery Testing**: Daily verification that backups can be restored
- **30-Day Retention Policy**: Automatic cleanup of old backups
- **REST API**: Manual backup trigger and status monitoring

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MongoDB       │────▶│  Backup Service  │────▶│     AWS S3      │
│   (Source)      │     │  (Encryption)    │     │   (Storage)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                        │
                                ▼                        ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │ Recovery Test    │◀────│  Metadata       │
                        │ Service          │     │  (IV, Salt)     │
                        └──────────────────┘     └─────────────────┘
```

## Components

### 1. Backup Encryption Utils (`utils/backup-encryption.js`)

Provides AES-256-GCM encryption for backup files:

- `encryptFile(inputPath, outputPath, password)` - Encrypts a file
- `decryptFile(inputPath, outputPath, password, iv, salt)` - Decrypts a file
- `encryptBuffer(data, password)` - Encrypts buffer data
- `decryptBuffer(encryptedBase64, password, iv, salt, authTag)` - Decrypts buffer data
- `generatePassword(length)` - Generates a secure random password

### 2. Backup Service (`services/backup-service.js`)

Handles the backup workflow:

- Creates MongoDB dumps using `mongodump`
- Encrypts backups using AES-256-GCM
- Uploads encrypted backups to S3
- Stores encryption metadata (IV, salt) separately
- Enforces 30-day retention policy
- Scheduled via cron (default: daily at 02:00 UTC)

### 3. Recovery Test Service (`services/recovery-test-service.js`)

Verifies backup integrity:

- Downloads latest backup from S3
- Decrypts backup using stored metadata
- Verifies gzip integrity with `gunzip -t`
- Performs dry-run restore with `mongorestore --dryRun`
- Scheduled via cron (default: daily at 03:00 UTC)

### 4. Backup Routes (`routes/backup-routes.js`)

REST API endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backups/trigger` | Manually trigger a backup |
| GET | `/api/backups` | List all available backups |
| GET | `/api/backups/metadata` | List backup metadata |
| POST | `/api/backups/test-recovery` | Trigger a recovery test |
| GET | `/api/backups/status` | Get backup system status |

## Environment Variables

Add these to your `.env` file:

```bash
# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BACKUP_BUCKET=your-bucket-name

# Backup Encryption
# IMPORTANT: Store this password securely!
BACKUP_ENCRYPTION_PASSWORD=your-secure-password

# Backup Schedule (cron syntax)
BACKUP_CRON_SCHEDULE=0 2 * * *

# Recovery Test Schedule (cron syntax)
RECOVERY_TEST_CRON_SCHEDULE=0 3 * * *

# Test MongoDB URI (optional)
TEST_MONGO_URI=mongodb://localhost:27017/soromint_test
```

## Testing

Run the unit tests:

```bash
npm test -- --testPathPattern="backup"
```

## Verification Steps

1. **Install dependencies**: `npm install`
2. **Configure environment**: Copy `.env.example.backup` to `.env` and set values
3. **Start server**: `npm run dev`
4. **Test backup**: `POST /api/backups/trigger`
5. **Check status**: `GET /api/backups/status`
6. **Test recovery**: `POST /api/backups/test-recovery`

## Security Considerations

1. **Encryption Password**: Store securely; backups cannot be restored without it
2. **S3 Bucket**: Use bucket policies to restrict access
3. **IAM Credentials**: Use least-privilege IAM user for S3 access
4. **Test Database**: Use separate MongoDB instance for recovery testing
5. **Monitoring**: Check logs for backup/recovery test failures

## S3 Bucket Structure

```
your-bucket-name/
├── backups/
│   ├── encrypted-2024-01-01T02-00-00.enc
│   ├── encrypted-2024-01-02T02-00-00.enc
│   └── ...
└── backups/metadata/
    ├── encrypted-2024-01-01T02-00-00.enc.json
    ├── encrypted-2024-01-02T02-00-00.enc.json
    └── ...
```

## Troubleshooting

### Backup fails to start
- Check that `MONGO_URI` and `AWS_S3_BACKUP_BUCKET` are set
- Verify AWS credentials are valid

### Recovery test fails
- Ensure `BACKUP_ENCRYPTION_PASSWORD` is set
- Check that backup exists in S3
- Verify test MongoDB URI if provided

### Encryption/decryption errors
- Verify the encryption password hasn't changed
- Check that metadata files exist in S3