const { 
  rpc, 
  StrKey, 
  Asset, 
  Operation, 
  TransactionBuilder, 
  Networks,
  Address
} = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

/**
 * @title FailoverRpcServer
 * @notice A wrapper for Soroban RPC server with failover and retry capabilities.
 * @dev Manages an array of RPC endpoints and automatically cycles through them on failure.
 */
class FailoverRpcServer {
  /**
   * @notice Initializes the failover server with multiple endpoints.
   * @param {string[]} urls - Array of Soroban RPC endpoint URLs.
   */
  constructor(urls) {
    if (!urls || urls.length === 0) {
      throw new Error('No RPC URLs provided for FailoverRpcServer');
    }
    this.urls = urls;
    this.currentIndex = 0;
    this.instances = urls.map(url => new rpc.Server(url));
  }

  /**
   * @notice Gets the current RPC server instance.
   * @returns {rpc.Server} The current Stellar Soroban RPC server instance.
   */
  get current() {
    return this.instances[this.currentIndex];
  }

  /**
   * @notice Cycles to the next available RPC endpoint.
   * @dev Useful when the current endpoint is unresponsive or returns errors.
   */
  next() {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
    logger.warn('Switching to next RPC endpoint', {
      url: this.urls[this.currentIndex],
      index: this.currentIndex
    });
  }

  /**
   * @notice Executes an RPC call with automatic failover.
   * @dev Tries to execute the provided function. If it fails, switches to the next endpoint and retries.
   * @param {Function} fn - A function that takes an rpc.Server instance and returns a promise.
   * @returns {Promise<any>} The result of the RPC call.
   * @throws {Error} If all endpoints fail.
   */
  async execute(fn) {
    let lastError;

    for (let i = 0; i < this.urls.length; i++) {
      try {
        return await fn(this.current);
      } catch (error) {
        lastError = error;
        logger.error('RPC call failed, attempting failover', {
          url: this.urls[this.currentIndex],
          error: error.message
        });
        this.next();
      }
    }

    logger.error('All RPC endpoints failed');
    throw lastError;
  }
}

let failoverServer = null;

/**
 * @title getRpcServer
 * @notice Initializes or returns a singleton connection to the Soroban RPC.
 * @dev Reads SOROBAN_RPC_URLS (comma-separated) or fallback to SOROBAN_RPC_URL.
 * @returns {FailoverRpcServer} The failover-enabled RPC server wrapper.
 */
const getRpcServer = () => {
  if (failoverServer) return failoverServer;

  const env = getEnv();
  const urls = env.SOROBAN_RPC_URLS 
    ? env.SOROBAN_RPC_URLS.split(',').map(u => u.trim()).filter(Boolean)
    : [env.SOROBAN_RPC_URL];

  failoverServer = new FailoverRpcServer(urls);
  return failoverServer;
};

/**
 * @title wrapAsset
 * @notice Boierplate for wrapping an existing XLM/Asset into a Soroban Token.
 * @param {string} assetCode - 'XLM' or code like 'USDC'
 * @param {string} assetIssuer - Issuer address (null for XLM)
 * @returns {Promise<Asset>} The wrapped asset object.
 */
const wrapAsset = async (assetCode, assetIssuer) => {
  const asset = assetCode === 'XLM' 
    ? Asset.native() 
    : new Asset(assetCode, assetIssuer);
  
  // Logic to get the contract ID for the wrapped asset
  // Note: This often requires calling the RPC or using a predictable derivation logic
  console.log(`Wrapping asset: ${assetCode}`);
  return asset;
};

/**
 * @title deployStellarAssetContract
 * @notice Boierplate for deploying a custom Stellar Asset Contract.
 * @param {string} wasmHash - Salt for deployment.
 * @param {string} salt - Salt for deployment.
 * @param {string} sourceAccount - Source account for deployment.
 * @returns {Promise<Object>} Deployment result containing contract ID and status.
 */
const deployStellarAssetContract = async (wasmHash, salt, sourceAccount) => {
  // 1. Create a deployment operation (e.g. createContractHostFunction)
  // 2. Build, sign, and submit transaction
  // This is a complex operation that usually involves source signing on client or server
  console.log('Deploying Custom Stellar Asset Contract...');
  return {
    contractId: 'C...', // Placeholder for generated contract ID
    status: 'pending'
  };
};

module.exports = {
  getRpcServer,
  wrapAsset,
  deployStellarAssetContract,
  FailoverRpcServer
};

