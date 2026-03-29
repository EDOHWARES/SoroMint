const { 
  rpc, 
  StrKey, 
  Asset, 
  Operation, 
  TransactionBuilder, 
  Networks,
  Address,
  Contract,
  nativeToScVal,
  xdr,
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

/**
 * @title submitBatchOperations
 * @notice Validates, builds, simulates, and submits multiple token operations
 *         as a single atomic Soroban transaction.
 * @dev Each operation maps to a contract invocation (mint/burn/transfer).
 *      Simulation is run first to preflight fees and catch per-op errors.
 * @param {Object[]} operations - Array of validated batch operation objects.
 * @param {string} sourcePublicKey - Stellar public key of the submitting account.
 * @returns {Promise<Object>} Result with txHash and per-operation outcomes.
 */
const submitBatchOperations = async (operations, sourcePublicKey) => {
  const server = getRpcServer();
  const env = getEnv();

  // Fetch source account for sequence number
  const account = await server.execute((s) => s.getAccount(sourcePublicKey));

  const txBuilder = new TransactionBuilder(account, {
    fee: '1000000', // generous base fee; simulation will refine
    networkPassphrase: env.NETWORK_PASSPHRASE,
  });

  // Build one contract invocation per operation
  for (const op of operations) {
    const contract = new Contract(op.contractId);
    let invokeOp;

    if (op.type === 'mint') {
      invokeOp = contract.call(
        'mint',
        new Address(sourcePublicKey).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    } else if (op.type === 'burn') {
      invokeOp = contract.call(
        'burn',
        new Address(sourcePublicKey).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    } else {
      // transfer
      invokeOp = contract.call(
        'transfer',
        new Address(sourcePublicKey).toScVal(),
        new Address(op.destination).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    }

    txBuilder.addOperation(invokeOp);
  }

  const tx = txBuilder.setTimeout(30).build();

  // Simulate to detect per-operation failures before submission
  const simulation = await server.execute((s) => s.simulateTransaction(tx));

  if (rpc.Api.isSimulationError(simulation)) {
    // Map simulation error back to operations for detailed reporting
    return {
      success: false,
      error: simulation.error,
      results: operations.map((op, i) => ({
        index: i,
        type: op.type,
        contractId: op.contractId,
        status: 'FAILED',
        error: simulation.error,
      })),
    };
  }

  // Assemble the transaction with simulation-derived auth and fee
  const preparedTx = rpc.assembleTransaction(tx, simulation).build();

  // Submit — note: in production the tx must be signed before this step.
  // The caller is responsible for signing; here we submit the prepared tx.
  const sendResult = await server.execute((s) => s.sendTransaction(preparedTx));

  logger.info('Batch transaction submitted', {
    hash: sendResult.hash,
    status: sendResult.status,
    operationCount: operations.length,
  });

  return {
    success: sendResult.status !== 'ERROR',
    txHash: sendResult.hash,
    status: sendResult.status,
    results: operations.map((op, i) => ({
      index: i,
      type: op.type,
      contractId: op.contractId,
      status: sendResult.status === 'ERROR' ? 'FAILED' : 'SUBMITTED',
    })),
  };
};

module.exports = {
  getRpcServer,
  wrapAsset,
  deployStellarAssetContract,
  FailoverRpcServer,
  submitBatchOperations,
};

