const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/error-handler');

/**
 * @title IPFS Service
 * @notice Service for pinning files and JSON to IPFS via Pinata
 */
class IpfsService {
  constructor() {
    const env = getEnv();
    this.apiKey = env.PINATA_API_KEY;
    this.secretApiKey = env.PINATA_SECRET_API_KEY;
    this.baseUrl = 'https://api.pinata.cloud';
  }

  get isConfigured() {
    return !!(this.apiKey && this.secretApiKey);
  }

  get headers() {
    return {
      pinata_api_key: this.apiKey,
      pinata_secret_api_key: this.secretApiKey,
    };
  }

  /**
   * @notice Pins a base64 string (image) to IPFS
   * @param {string} base64String - Base64 encoded file data
   * @param {string} name - Optional name for the file in Pinata
   * @returns {Promise<string>} The IPFS CID of the pinned file
   */
  async pinFileToIPFS(base64String, name = 'token-icon') {
    if (!this.isConfigured) {
      logger.warn('Pinata keys missing. Skipping file pinning.');
      return null;
    }

    try {
      // Extract content type and base64 data
      const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new AppError('Invalid base64 string format', 400);
      }

      const contentType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const blob = new Blob([buffer], { type: contentType });

      const formData = new FormData();
      formData.append('file', blob, name);

      const pinataMetadata = JSON.stringify({ name });
      formData.append('pinataMetadata', pinataMetadata);

      const pinataOptions = JSON.stringify({ cidVersion: 1 });
      formData.append('pinataOptions', pinataOptions);

      const response = await fetch(`${this.baseUrl}/pinning/pinFileToIPFS`, {
        method: 'POST',
        headers: this.headers,
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pinata API Error: ${errorText}`);
      }

      const data = await response.json();
      logger.info('Successfully pinned file to IPFS', { cid: data.IpfsHash });
      return data.IpfsHash;
    } catch (error) {
      logger.error('Failed to pin file to IPFS', { error: error.message });
      throw new AppError(`IPFS pinning failed: ${error.message}`, 500);
    }
  }

  /**
   * @notice Pins a JSON object to IPFS
   * @param {Object} jsonData - The metadata object
   * @param {string} name - Optional name for the JSON in Pinata
   * @returns {Promise<string>} The IPFS CID of the pinned JSON
   */
  async pinJSONToIPFS(jsonData, name = 'token-metadata.json') {
    if (!this.isConfigured) {
      logger.warn('Pinata keys missing. Skipping JSON pinning.');
      return null;
    }

    try {
      const payload = {
        pinataContent: jsonData,
        pinataMetadata: { name },
        pinataOptions: { cidVersion: 1 }
      };

      const response = await fetch(`${this.baseUrl}/pinning/pinJSONToIPFS`, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pinata API Error: ${errorText}`);
      }

      const data = await response.json();
      logger.info('Successfully pinned JSON to IPFS', { cid: data.IpfsHash });
      return data.IpfsHash;
    } catch (error) {
      logger.error('Failed to pin JSON to IPFS', { error: error.message });
      throw new AppError(`IPFS JSON pinning failed: ${error.message}`, 500);
    }
  }
}

module.exports = new IpfsService();
