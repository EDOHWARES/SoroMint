/**
 * @title Backup Encryption Utilities
 * @description Provides AES-256-GCM encryption for database backups before S3 upload
 * @dev Uses Node.js built-in crypto module for secure encryption
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Derives an encryption key from the backup encryption password using PBKDF2
 * @param {string} password - The encryption password
 * @param {Buffer} salt - Random salt for key derivation
 * @returns {Buffer} Derived encryption key
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, "sha512");
}

/**
 * Encrypts a file using AES-256-GCM
 * @param {string} inputPath - Path to the file to encrypt
 * @param {string} outputPath - Path where encrypted file will be saved
 * @param {string} password - Encryption password
 * @returns {Object} Object containing the output path, IV, and salt used
 */
function encryptFile(inputPath, outputPath, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    input.pipe(cipher).pipe(output);

    output.on("finish", () => {
      logger.info("File encrypted successfully", { outputPath });
      resolve({
        outputPath,
        iv: iv.toString("base64"),
        salt: salt.toString("base64"),
      });
    });

    output.on("error", (err) => {
      logger.error("Encryption failed", { error: err.message });
      reject(err);
    });

    input.on("error", (err) => {
      logger.error("Read error during encryption", { error: err.message });
      reject(err);
    });
  });
}

/**
 * Decrypts an AES-256-GCM encrypted file
 * @param {string} inputPath - Path to the encrypted file
 * @param {string} outputPath - Path where decrypted file will be saved
 * @param {string} password - Decryption password
 * @param {string} ivBase64 - IV used during encryption (base64)
 * @param {string} saltBase64 - Salt used during encryption (base64)
 * @returns {string} Path to the decrypted file
 */
function decryptFile(inputPath, outputPath, password, ivBase64, saltBase64) {
  const salt = Buffer.from(saltBase64, "base64");
  const key = deriveKey(password, salt);
  const iv = Buffer.from(ivBase64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    input.pipe(decipher).pipe(output);

    output.on("finish", () => {
      logger.info("File decrypted successfully", { outputPath });
      resolve(outputPath);
    });

    output.on("error", (err) => {
      logger.error("Decryption failed", { error: err.message });
      reject(err);
    });

    input.on("error", (err) => {
      logger.error("Read error during decryption", { error: err.message });
      reject(err);
    });
  });
}

/**
 * Encrypts buffer data using AES-256-GCM
 * @param {Buffer} data - Data to encrypt
 * @param {string} password - Encryption password
 * @returns {Object} Object containing encrypted data, IV, and salt
 */
function encryptBuffer(data, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypts buffer data using AES-256-GCM
 * @param {string} encryptedBase64 - Base64 encoded encrypted data
 * @param {string} password - Decryption password
 * @param {string} ivBase64 - IV used during encryption (base64)
 * @param {string} saltBase64 - Salt used during encryption (base64)
 * @param {string} authTagBase64 - Auth tag from encryption (base64)
 * @returns {Buffer} Decrypted data
 */
function decryptBuffer(encryptedBase64, password, ivBase64, saltBase64, authTagBase64) {
  const salt = Buffer.from(saltBase64, "base64");
  const key = deriveKey(password, salt);
  const iv = Buffer.from(ivBase64, "base64");
  const encryptedData = Buffer.from(encryptedBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * Generates a secure random encryption password
 * @param {number} length - Password length (default: 32)
 * @returns {string} Random password
 */
function generatePassword(length = 32) {
  return crypto.randomBytes(length).toString("base64");
}

/**
 * Verifies that a password can decrypt a file by attempting decryption
 * @param {string} filePath - Path to encrypted file
 * @param {string} password - Password to verify
 * @returns {boolean} True if password is correct
 */
async function verifyPassword(filePath, password) {
  try {
    const testOutput = filePath + ".test.decrypt";
    // This will throw if password is wrong
    await decryptFile(filePath, testOutput, password, "", "");
    // Clean up test file
    if (fs.existsSync(testOutput)) {
      fs.unlinkSync(testOutput);
    }
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  encryptFile,
  decryptFile,
  encryptBuffer,
  decryptBuffer,
  generatePassword,
  verifyPassword,
  ALGORITHM,
};