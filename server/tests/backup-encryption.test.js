/**
 * @title Backup Encryption Unit Tests
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  encryptFile,
  decryptFile,
  encryptBuffer,
  decryptBuffer,
  generatePassword,
  ALGORITHM,
} = require("../utils/backup-encryption");

describe("Backup Encryption Utils", () => {
  const testDir = path.join(__dirname, "../.test-backups");
  const testPassword = "test-encryption-password-123";

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testDir)) {
      fs.readdirSync(testDir).forEach((file) => {
        fs.unlinkSync(path.join(testDir, file));
      });
      fs.rmdirSync(testDir);
    }
  });

  describe("generatePassword", () => {
    it("should generate a password of default length", () => {
      const password = generatePassword();
      expect(password).toBeDefined();
      expect(typeof password).toBe("string");
      expect(password.length).toBeGreaterThan(0);
    });

    it("should generate a password of specified length", () => {
      const password = generatePassword(16);
      const decoded = Buffer.from(password, "base64");
      expect(decoded.length).toBe(16);
    });

    it("should generate unique passwords each time", () => {
      const password1 = generatePassword();
      const password2 = generatePassword();
      expect(password1).not.toBe(password2);
    });
  });

  describe("encryptFile and decryptFile", () => {
    it("should encrypt and decrypt a file correctly", async () => {
      const inputPath = path.join(testDir, "test-input.txt");
      const encryptedPath = path.join(testDir, "test-encrypted.enc");
      const decryptedPath = path.join(testDir, "test-decrypted.txt");

      // Create test file
      const testContent = "This is a test file content for encryption";
      fs.writeFileSync(inputPath, testContent);

      // Encrypt
      const { iv, salt } = await encryptFile(inputPath, encryptedPath, testPassword);
      expect(iv).toBeDefined();
      expect(salt).toBeDefined();
      expect(fs.existsSync(encryptedPath)).toBe(true);

      // Decrypt
      await decryptFile(encryptedPath, decryptedPath, testPassword, iv, salt);
      expect(fs.existsSync(decryptedPath)).toBe(true);

      // Verify content
      const decryptedContent = fs.readFileSync(decryptedPath, "utf8");
      expect(decryptedContent).toBe(testContent);

      // Clean up
      fs.unlinkSync(inputPath);
      fs.unlinkSync(encryptedPath);
      fs.unlinkSync(decryptedPath);
    });

    it("should produce different output for same input with different IVs", async () => {
      const inputPath = path.join(testDir, "test-input2.txt");
      const encryptedPath1 = path.join(testDir, "test-encrypted1.enc");
      const encryptedPath2 = path.join(testDir, "test-encrypted2.enc");

      const testContent = "Same content for both encryptions";
      fs.writeFileSync(inputPath, testContent);

      await encryptFile(inputPath, encryptedPath1, testPassword);
      await encryptFile(inputPath, encryptedPath2, testPassword);

      const encrypted1 = fs.readFileSync(encryptedPath1);
      const encrypted2 = fs.readFileSync(encryptedPath2);

      // Should be different due to random IV
      expect(encrypted1.equals(encrypted2)).toBe(false);

      // Clean up
      fs.unlinkSync(inputPath);
      fs.unlinkSync(encryptedPath1);
      fs.unlinkSync(encryptedPath2);
    });

    it("should fail to decrypt with wrong password", async () => {
      const inputPath = path.join(testDir, "test-input3.txt");
      const encryptedPath = path.join(testDir, "test-encrypted3.enc");
      const decryptedPath = path.join(testDir, "test-decrypted3.txt");

      const testContent = "Secret content";
      fs.writeFileSync(inputPath, testContent);

      const { iv, salt } = await encryptFile(inputPath, encryptedPath, testPassword);

      // Try to decrypt with wrong password
      await expect(
        decryptFile(encryptedPath, decryptedPath, "wrong-password", iv, salt)
      ).rejects.toThrow();

      // Clean up
      fs.unlinkSync(inputPath);
      if (fs.existsSync(encryptedPath)) fs.unlinkSync(encryptedPath);
    });
  });

  describe("encryptBuffer and decryptBuffer", () => {
    it("should encrypt and decrypt buffer data correctly", () => {
      const testData = Buffer.from("Test data for buffer encryption", "utf8");
      const { encryptedData, iv, salt, authTag } = encryptBuffer(testData, testPassword);

      expect(encryptedData).toBeDefined();
      expect(iv).toBeDefined();
      expect(salt).toBeDefined();
      expect(authTag).toBeDefined();

      const decrypted = decryptBuffer(encryptedData, testPassword, iv, salt, authTag);
      expect(decrypted.equals(testData)).toBe(true);
    });

    it("should fail to decrypt buffer with wrong password", () => {
      const testData = Buffer.from("Secret buffer data", "utf8");
      const { encryptedData, iv, salt, authTag } = encryptBuffer(testData, testPassword);

      expect(() => {
        decryptBuffer(encryptedData, "wrong-password", iv, salt, authTag);
      }).toThrow();
    });
  });

  describe("ALGORITHM", () => {
    it("should use AES-256-GCM", () => {
      expect(ALGORITHM).toBe("aes-256-gcm");
    });
  });
});