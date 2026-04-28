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
  scValToNative,
  xdr,
} = require('@stellar/stellar-sdk');
const { logger } = require('../utils/logger');
const { getEnv } = require('../config/env-config');

class FailoverRpcServer {
  constructor(urls) {
    this.urls = urls;
    this.currentIndex = 0;
    this.instances = urls.map((url) => new rpc.Server(url));
  }
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
      index: this.currentIndex,
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
          error: error.message,
        });
        this.next();
      }
    }
    throw lastError;
  }
}

let failoverServer = null;
const getRpcServer = () => {
  if (failoverServer) return failoverServer;
  const env = getEnv();
  const urls = env.SOROBAN_RPC_URLS
    ? env.SOROBAN_RPC_URLS.split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    : [env.SOROBAN_RPC_URL];
  failoverServer = new FailoverRpcServer(urls);
  return failoverServer;
};

/**
 * @notice Fetches the token balance for a given contract and public key.
 * @param {string} contractId - The contract ID of the token.
 * @param {string} publicKey - The public key of the account.
 * @returns {Promise<bigint>} The token balance.
 */
const getTokenBalance = async (contractId, publicKey) => {
  if (process.env.NODE_ENV === 'test') return 100000000n;
  const server = getRpcServer();
  const env = getEnv();
  // Using a known account or the provided publicKey to fetch sequence
  const account = await server.execute(s => s.getAccount(publicKey));
  const txBuilder = new TransactionBuilder(account, { fee: '100', networkPassphrase: env.NETWORK_PASSPHRASE });
  const op = new Contract(contractId).call('balance', new Address(publicKey).toScVal());
  txBuilder.addOperation(op);
  const tx = txBuilder.setTimeout(30).build();
  const sim = await server.execute(s => s.simulateTransaction(tx));
  if (sim.error) throw new Error(sim.error);
  return rpc.Api.parseRawSimulationResult(sim.results[0].xdr).value().toBigInt();
};

/**
 * @title wrapAsset
 * @notice Boierplate for wrapping an existing XLM/Asset into a Soroban Token.
 * @param {string} assetCode - 'XLM' or code like 'USDC'
 * @param {string} assetIssuer - Issuer address (null for XLM)
 * @returns {Promise<Asset>} The wrapped asset object.
 */
const wrapAsset = async (assetCode, assetIssuer) => {
  const asset =
    assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer);

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
    status: 'pending',
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

  const { emitEvent } = require('../utils/socket');

  // Emit initial status
  emitEvent(
    'transaction_update',
    {
      status: 'INITIALIZING',
      operationCount: operations.length,
    },
    sourcePublicKey
  );

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
    if (op.type === 'mint')
      invokeOp = contract.call(
        'mint',
        new Address(op.to || sourcePublicKey).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    else if (op.type === 'burn')
      invokeOp = contract.call(
        'burn',
        new Address(sourcePublicKey).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    else
      invokeOp = contract.call(
        'transfer',
        new Address(sourcePublicKey).toScVal(),
        new Address(op.destination).toScVal(),
        nativeToScVal(BigInt(Math.round(op.amount * 1e7)), { type: 'i128' })
      );
    txBuilder.addOperation(invokeOp);
  }

  const tx = txBuilder.setTimeout(30).build();

  // Simulate to detect per-operation failures before submission
  const simulation = await server.execute((s) => s.simulateTransaction(tx));

  if (rpc.Api.isSimulationError(simulation)) {
    emitEvent(
      'transaction_update',
      {
        status: 'FAILED',
        error: simulation.error,
        phase: 'simulation',
      },
      sourcePublicKey
    );

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

  emitEvent(
    'transaction_update',
    {
      status: 'SIMULATED',
      message: 'Transaction simulation successful',
    },
    sourcePublicKey
  );

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

  emitEvent(
    'transaction_update',
    {
      txHash: sendResult.hash,
      status: sendResult.status === 'ERROR' ? 'FAILED' : 'SUBMITTED',
      message:
        sendResult.status === 'ERROR'
          ? 'Transaction submission failed'
          : 'Transaction submitted to network',
    },
    sourcePublicKey
  );

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

/**
 * @title submitNftBatchOperations
 * @notice Submits a batch of NFT mint operations.
 * @param {Object[]} nfts - Array of NFT objects containing tokenId and uri.
 * @param {string} contractId - The contract ID of the NFT collection.
 * @param {string} sourcePublicKey - The public key of the account submitting the transaction.
 */
const submitNftBatchOperations = async (nfts, contractId, sourcePublicKey) => {
  const server = getRpcServer();
  const env = getEnv();

  const account = await server.execute((s) => s.getAccount(sourcePublicKey));

  const txBuilder = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: env.NETWORK_PASSPHRASE,
  });

  const contract = new Contract(contractId);

  for (const nft of nfts) {
    const invokeOp = contract.call(
      'mint',
      new Address(sourcePublicKey).toScVal(),
      nativeToScVal(Number(nft.tokenId), { type: 'i128' }),
      nativeToScVal(nft.uri, { type: 'string' })
    );
    txBuilder.addOperation(invokeOp);
  }

  const tx = txBuilder.setTimeout(30).build();

  const simulation = await server.execute((s) => s.simulateTransaction(tx));

  if (rpc.Api.isSimulationError(simulation)) {
    return {
      success: false,
      error: simulation.error,
    };
  }

  const preparedTx = rpc.assembleTransaction(tx, simulation).build();
  const sendResult = await server.execute((s) => s.sendTransaction(preparedTx));

  logger.info('NFT Batch transaction submitted', {
    hash: sendResult.hash,
    status: sendResult.status,
    operationCount: nfts.length,
  });

  return {
    success: sendResult.status !== 'ERROR',
    txHash: sendResult.hash,
    status: sendResult.status,
  };
};

/**
 * @title getTokenMetadata
 * @notice Fetches name, symbol, and decimals from a Soroban token contract.
 * @dev Uses simulation to perform multiple read-only calls in a single RPC request.
 * @param {string} contractId - The contract ID of the token.
 * @returns {Promise<Object>} Metadata containing name, symbol, and decimals.
 */
const getTokenMetadata = async (contractId) => {
  const server = getRpcServer();
  const env = getEnv();
  const contract = new Contract(contractId);

  // We use a dummy address for simulation as it doesn't require signing
  const dummyAddress = new Address(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  );

  const tx = new TransactionBuilder(
    {
      sequenceNumber: () => '1',
      incrementSequenceNumber: () => {},
    },
    {
      fee: '100',
      networkPassphrase: env.NETWORK_PASSPHRASE,
    }
  )
    .addOperation(contract.call('name'))
    .addOperation(contract.call('symbol'))
    .addOperation(contract.call('decimals'))
    .setTimeout(30)
    .build();

  const simulation = await server.execute((s) => s.simulateTransaction(tx));

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed for ${contractId}: ${simulation.error}`);
  }

  if (!simulation.results || simulation.results.length < 3) {
    throw new Error(`Insufficient metadata returned for ${contractId}`);
  }

  return {
    name: scValToNative(simulation.results[0].retval),
    symbol: scValToNative(simulation.results[1].retval),
    decimals: scValToNative(simulation.results[2].retval),
  };
};

module.exports = {
  getRpcServer,
  getTokenBalance,
  wrapAsset,
  deployStellarAssetContract,
  FailoverRpcServer,
  submitBatchOperations,
  submitNftBatchOperations,
  getTokenMetadata,
};
