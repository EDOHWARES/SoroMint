/**
 * @title Backup Service Unit Tests
 */

const path = require("path");
const fs = require("fs");

// Mock dependencies
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn((params) => ({ type: "PutObject", params })),
  ListObjectsV2Command: jest.fn((params) => ({ type: "ListObjects", params })),
  DeleteObjectsCommand: jest.fn((params) => ({ type: "DeleteObjects", params })),
  GetObjectCommand: jest.fn((params) => ({ type: "GetObject", params })),
}));

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

jest.mock("../utils/backup-encryption", () => ({
  encryptFile: jest.fn().mockResolvedValue({
    iv: "test-iv",
    salt: "test-salt",
  }),
  decryptFile: jest.fn(),
  generatePassword: jest.fn().mockReturnValue("generated-password"),
}));

const { execSync } = require("child_process");
const { 
  scheduleBackups, 
  runBackup, 
  listBackups,
  getEncryptionPassword,
} = require("../services/backup-service");

describe("Backup Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { 
      ...originalEnv,
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      AWS_S3_BACKUP_BUCKET: "test-bucket",
      MONGO_URI: "mongodb://localhost:27017/test",
      BACKUP_ENCRYPTION_PASSWORD: "test-encryption-password",
    };
    
    // Create .backups directory
    const backupDir = path.join(__dirname, "../.backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getEncryptionPassword", () => {
    it("should return password from environment if set", () => {
      const password = getEncryptionPassword();
      expect(password).toBe("test-encryption-password");
    });

    it("should generate random password if not set", () => {
      delete process.env.BACKUP_ENCRYPTION_PASSWORD;
      const password = getEncryptionPassword();
      expect(password).toBeDefined();
      expect(password).toBe("generated-password");
    });
  });

  describe("runBackup", () => {
    it("should return error if MONGO_URI is not set", async () => {
      delete process.env.MONGO_URI;
      const result = await runBackup();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing MONGO_URI");
    });

    it("should return error if AWS_S3_BACKUP_BUCKET is not set", async () => {
      delete process.env.AWS_S3_BACKUP_BUCKET;
      const result = await runBackup();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing AWS_S3_BACKUP_BUCKET");
    });

    it("should create backup successfully with all required config", async () => {
      execSync.mockImplementation(() => {});

      const result = await runBackup();
      
      expect(result.success).toBe(true);
      expect(result.encrypted).toBe(true);
      expect(result.bucket).toBe("test-bucket");
      expect(result.key).toContain("backups/encrypted-");
    });
  });

  describe("listBackups", () => {
    it("should return error if bucket not configured", async () => {
      delete process.env.AWS_S3_BACKUP_BUCKET;
      const result = await listBackups();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("should return empty list if no backups exist", async () => {
      const { S3Client } = require("@aws-sdk/client-s3");
      const mockSend = jest.fn().mockResolvedValue({ Contents: [] });
      S3Client.mockImplementation(() => ({ send: mockSend }));

      const result = await listBackups();
      expect(result.success).toBe(true);
      expect(result.backups).toEqual([]);
    });

    it("should return list of backups", async () => {
      const { S3Client } = require("@aws-sdk/client-s3");
      const mockSend = jest.fn().mockResolvedValue({
        Contents: [
          { Key: "backups/encrypted-1.enc", Size: 1024, LastModified: new Date(), ETag: "etag1" },
          { Key: "backups/encrypted-2.enc", Size: 2048, LastModified: new Date(), ETag: "etag2" },
        ],
      });
      S3Client.mockImplementation(() => ({ send: mockSend }));

      const result = await listBackups();
      expect(result.success).toBe(true);
      expect(result.backups).toHaveLength(2);
    });
  });

  describe("scheduleBackups", () => {
    it("should schedule backup with default cron", () => {
      const cron = require("node-cron");
      const scheduleSpy = jest.spyOn(cron, "schedule");
      
      scheduleBackups();
      
      expect(scheduleSpy).toHaveBeenCalledWith(
        "0 2 * * *",
        expect.any(Function)
      );
    });

    it("should use custom cron from environment", () => {
      process.env.BACKUP_CRON_SCHEDULE = "0 */6 * * *";
      const cron = require("node-cron");
      const scheduleSpy = jest.spyOn(cron, "schedule");
      
      scheduleBackups();
      
      expect(scheduleSpy).toHaveBeenCalledWith(
        "0 */6 * * *",
        expect.any(Function)
      );
    });

    it("should not schedule if cron is invalid", () => {
      process.env.BACKUP_CRON_SCHEDULE = "invalid-cron";
      const cron = require("node-cron");
      const scheduleSpy = jest.spyOn(cron, "schedule");
      
      scheduleBackups();
      
      expect(scheduleSpy).not.toHaveBeenCalled();
    });
  });
});