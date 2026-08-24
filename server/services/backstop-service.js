/**
 * @title Backstop / Insurance Fund Service
 * @description Backend service for the SoroMint Backstop (insurance fund) Soroban
 *              contract. Proxies read/write calls to the on-chain contract via
 *              Soroban RPC.
 * @notice All diagnostics are emitted through the configured Winston logger
 *         (see ../utils/logger) as structured JSON payloads so they can be
 *         consumed by observability tooling such as Datadog or ELK. Context
 *         such as userId, transactionId and contractId is attached to every
 *         entry — no console.log / console.error calls are used.
 */

const {
  Keypair,
  Networks,
  Contract,
  Address,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

const MAX_FEE_BPS = 10_000;
const POLL_ATTEMPTS = 10;
const POLL_DELAY_MS = 2000;

/**
 * @notice Application error for backstop service failures.
 * @dev Carries an HTTP status + machine-readable code so routes can map it to a
 *      standardized error response without leaking internals.
 */
class BackstopServiceError extends Error {
  constructor(message, statusCode = 500, code = 'BACKSTOP_SERVICE_ERROR') {
    super(message);
    this.name = 'BackstopServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

/**
 * @notice Creates the Soroban RPC server from validated environment config.
 */
const getRpcServer = () => {
  const env = getEnv();
  return new rpc.Server(env.SOROBAN_RPC_URL);
};

/**
 * @notice Resolves the Stellar network passphrase for transaction building.
 */
const getNetworkPassphrase = () => {
  const env = getEnv();
  return env.NETWORK_PASSPHRASE || Networks.TESTNET;
};

/**
 * @notice Resolves the server-side signer keypair used for write operations.
 * @dev Prefers the dedicated BACKSTOP_ADMIN_SECRET variable and falls back to
 *      the generic ADMIN_SECRET_KEY used elsewhere in the codebase.
 * @throws {BackstopServiceError} 503 when no signer is configured.
 */
const getSigningKeypair = () => {
  const env = getEnv();
  const secret = env.BACKSTOP_ADMIN_SECRET || env.ADMIN_SECRET_KEY;
  if (!secret) {
    throw new BackstopServiceError(
      'Backstop write operations require a server signer. Set BACKSTOP_ADMIN_SECRET or ADMIN_SECRET_KEY.',
      503,
      'BACKSTOP_SIGNER_NOT_CONFIGURED'
    );
  }
  return Keypair.fromSecret(secret);
};

/**
 * @notice Dummy account used to simulate read-only contract invocations without
 *         needing a funded source account (mirrors getTokenMetadata pattern).
 */
const DUMMY_SOURCE_ACCOUNT = {
  sequenceNumber: () => '1',
  incrementSequenceNumber: () => {},
};

/**
 * @notice Runs a read-only Soroban invocation (simulation) for the Backstop
 *         contract and returns the decoded return value.
 * @param {string} contractId - Backstop contract C-address.
 * @param {string} method - Contract method name (e.g. get_config, version).
 * @param {Array} args - Pre-built ScVal arguments.
 * @param {object} context - Structured logging context (userId, transactionId…).
 * @returns {*} Decoded return value via scValToNative.
 */
const simulateRead = async (contractId, method, args = [], context = {}) => {
  const server = getRpcServer();
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(DUMMY_SOURCE_ACCOUNT, {
    fee: '100',
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  logger.info('Backstop read invocation simulating', {
    contractId,
    method,
    ...context,
  });

  const simulation = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    logger.error('Backstop read invocation simulation failed', {
      contractId,
      method,
      error: simulation.error,
      ...context,
    });
    throw new BackstopServiceError(
      `Backstop ${method} simulation failed for ${contractId}: ${simulation.error}`,
      502,
      'BACKSTOP_SIMULATION_ERROR'
    );
  }

  if (!simulation.results || simulation.results.length === 0) {
    logger.error('Backstop read invocation returned no results', {
      contractId,
      method,
      ...context,
    });
    throw new BackstopServiceError(
      `Backstop ${method} returned no results for ${contractId}`,
      502,
      'BACKSTOP_EMPTY_RESULT'
    );
  }

  const value = scValToNative(simulation.results[0].retval);

  logger.info('Backstop read invocation simulated', {
    contractId,
    method,
    ...context,
  });

  return value;
};

/**
 * @notice Builds, simulates, signs and submits a Backstop write transaction and
 *         waits for on-chain confirmation.
 * @param {string} contractId - Backstop contract C-address.
 * @param {string} method - Contract method name (deposit_fee, withdraw, set_fee_bps).
 * @param {Array} args - Pre-built ScVal arguments.
 * @param {object} context - Structured logging context (userId, transactionId…).
 * @returns {Promise<{success: boolean, txHash: string, status: string}>}
 */
const submitInvocation = async (contractId, method, args, context = {}) => {
  const { userId, transactionId, ...meta } = context;
  const server = getRpcServer();
  const keypair = getSigningKeypair();
  const sourcePublicKey = keypair.publicKey();
  const contract = new Contract(contractId);

  logger.info('Backstop write intent', {
    contractId,
    method,
    sourcePublicKey,
    userId,
    transactionId,
    ...meta,
  });

  const sourceAccount = await server.getAccount(sourcePublicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate + assemble — derives the required auth entries and fee.
  const preparedTx = await server.prepareTransaction(tx);

  // Authorize the invocation with the server signer.
  preparedTx.sign(keypair);

  logger.info('Backstop write submitting transaction', {
    contractId,
    method,
    userId,
    transactionId,
  });

  const sendResponse = await server.sendTransaction(preparedTx);

  if (sendResponse.status === 'ERROR') {
    logger.error('Backstop write submission rejected', {
      contractId,
      method,
      userId,
      transactionId,
      error: sendResponse.error,
    });
    throw new BackstopServiceError(
      `Backstop ${method} submission rejected: ${sendResponse.error || JSON.stringify(sendResponse)}`,
      502,
      'BACKSTOP_SUBMISSION_REJECTED'
    );
  }

  const transactionHash = sendResponse.hash;

  logger.info('Backstop write submitted', {
    contractId,
    method,
    userId,
    transactionId,
    txHash: transactionHash,
  });

  // Poll for the on-chain result.
  let txStatus = await server.getTransaction(transactionHash);
  let attempts = 0;

  while (txStatus.status === 'NOT_FOUND' && attempts < POLL_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
    txStatus = await server.getTransaction(transactionHash);
    attempts += 1;
  }

  if (txStatus.status === 'FAILED') {
    logger.error('Backstop write failed on chain', {
      contractId,
      method,
      userId,
      transactionId,
      txHash: transactionHash,
    });
    throw new BackstopServiceError(
      `Backstop ${method} transaction failed on chain: ${transactionHash}`,
      502,
      'BACKSTOP_TX_FAILED'
    );
  }

  if (txStatus.status !== 'SUCCESS') {
    logger.error('Backstop write timed out waiting for ledger', {
      contractId,
      method,
      userId,
      transactionId,
      txHash: transactionHash,
      status: txStatus.status,
    });
    throw new BackstopServiceError(
      `Backstop ${method} transaction timed out: ${transactionHash} (${txStatus.status})`,
      502,
      'BACKSTOP_TX_TIMEOUT'
    );
  }

  logger.info('Backstop write confirmed on chain', {
    contractId,
    method,
    userId,
    transactionId,
    txHash: transactionHash,
  });

  return { success: true, txHash: transactionHash, status: txStatus.status };
};

/**
 * @notice Fetches the full Backstop configuration via a single get_config() call.
 * @param {string} contractId - Backstop contract C-address.
 * @param {object} context - Structured logging context.
 * @returns {Promise<{admin: string, token: string, fee_bps: number, total_deposited: string, total_withdrawn: string}>}
 */
const getConfig = async (contractId, context = {}) => {
  const raw = await simulateRead(contractId, 'get_config', [], context);
  const values = Array.isArray(raw)
    ? raw
    : [raw?.admin, raw?.token, raw?.fee_bps, raw?.total_deposited, raw?.total_withdrawn];

  const config = {
    admin: values[0] !== undefined && values[0] !== null ? String(values[0]) : null,
    token: values[1] !== undefined && values[1] !== null ? String(values[1]) : null,
    fee_bps:
      values[2] !== undefined && values[2] !== null ? Number(values[2]) : null,
    total_deposited:
      values[3] !== undefined && values[3] !== null ? String(values[3]) : null,
    total_withdrawn:
      values[4] !== undefined && values[4] !== null ? String(values[4]) : null,
  };

  logger.info('Backstop config retrieved', {
    contractId,
    ...config,
    ...context,
  });

  return config;
};

/**
 * @notice Fetches the on-chain token balance of the Backstop reserve via get_balance().
 * @param {string} contractId - Backstop contract C-address.
 * @param {object} context - Structured logging context.
 * @returns {Promise<{balance: string}>}
 */
const getBalance = async (contractId, context = {}) => {
  const raw = await simulateRead(contractId, 'get_balance', [], context);
  const balance = typeof raw === 'bigint' ? raw.toString() : String(raw ?? 0);

  logger.info('Backstop balance retrieved', {
    contractId,
    balance,
    ...context,
  });

  return { balance };
};

/**
 * @notice Fetches the Backstop contract version string (health ping).
 * @param {string} contractId - Backstop contract C-address.
 * @param {object} context - Structured logging context.
 * @returns {Promise<{version: string}>}
 */
const getVersion = async (contractId, context = {}) => {
  const raw = await simulateRead(contractId, 'version', [], context);
  const version = String(raw ?? '');

  logger.info('Backstop version retrieved', {
    contractId,
    version,
    ...context,
  });

  return { version };
};

/**
 * @notice Deposits a fee amount into the Backstop reserve (deposit_fee).
 * @dev The server signs the transaction, so `from` must be the configured
 *      server signer account (BACKSTOP_ADMIN_SECRET / ADMIN_SECRET_KEY).
 * @param {object} payload
 * @param {string} payload.contractId - Backstop contract C-address.
 * @param {string} payload.from - Signer account performing the deposit.
 * @param {number} payload.amount - Amount to deposit (integer units).
 * @param {string} [payload.userId] - Requesting user (structured log context).
 * @param {string} [payload.transactionId] - Correlation id (structured log context).
 * @returns {Promise<{success: boolean, txHash: string, status: string}>}
 */
const depositFee = async ({
  contractId,
  from,
  amount,
  userId,
  transactionId,
} = {}) => {
  if (!contractId || !from || amount === undefined || amount === null) {
    throw new BackstopServiceError(
      'contractId, from and amount are required',
      400,
      'BACKSTOP_INVALID_PAYLOAD'
    );
  }

  const keypair = getSigningKeypair();
  const sourcePublicKey = keypair.publicKey();

  if (from !== sourcePublicKey) {
    logger.warn('Backstop deposit from-account mismatch rejected', {
      contractId,
      userId,
      transactionId,
      from,
      sourcePublicKey,
    });
    throw new BackstopServiceError(
      'deposit_fee is authorised by the server signer, so `from` must match the configured BACKSTOP_ADMIN_SECRET / ADMIN_SECRET_KEY account.',
      403,
      'BACKSTOP_FROM_MISMATCH'
    );
  }

  return submitInvocation(
    contractId,
    'deposit_fee',
    [new Address(from).toScVal(), nativeToScVal(amount, { type: 'i128' })],
    { userId, transactionId, from, amount }
  );
};

/**
 * @notice Admin withdrawal from the Backstop reserve (withdraw).
 * @param {object} payload
 * @param {string} payload.contractId - Backstop contract C-address.
 * @param {string} payload.to - Destination account.
 * @param {number} payload.amount - Amount to withdraw (integer units).
 * @param {string} [payload.userId] - Requesting user (structured log context).
 * @param {string} [payload.transactionId] - Correlation id (structured log context).
 * @returns {Promise<{success: boolean, txHash: string, status: string}>}
 */
const withdraw = async ({ contractId, to, amount, userId, transactionId } = {}) => {
  if (!contractId || !to || amount === undefined || amount === null) {
    throw new BackstopServiceError(
      'contractId, to and amount are required',
      400,
      'BACKSTOP_INVALID_PAYLOAD'
    );
  }

  return submitInvocation(
    contractId,
    'withdraw',
    [new Address(to).toScVal(), nativeToScVal(amount, { type: 'i128' })],
    { userId, transactionId, to, amount }
  );
};

/**
 * @notice Updates the Backstop fee rate (set_fee_bps, admin only).
 * @param {object} payload
 * @param {string} payload.contractId - Backstop contract C-address.
 * @param {number} payload.fee_bps - New fee rate in basis points (0–10000).
 * @param {string} [payload.userId] - Requesting user (structured log context).
 * @param {string} [payload.transactionId] - Correlation id (structured log context).
 * @returns {Promise<{success: boolean, txHash: string, status: string}>}
 */
const setFeeBps = async ({ contractId, fee_bps, userId, transactionId } = {}) => {
  if (!contractId || fee_bps === undefined || fee_bps === null) {
    throw new BackstopServiceError(
      'contractId and fee_bps are required',
      400,
      'BACKSTOP_INVALID_PAYLOAD'
    );
  }

  if (fee_bps < 0 || fee_bps > MAX_FEE_BPS) {
    throw new BackstopServiceError(
      `fee_bps must be between 0 and ${MAX_FEE_BPS}`,
      400,
      'BACKSTOP_INVALID_FEE_BPS'
    );
  }

  return submitInvocation(
    contractId,
    'set_fee_bps',
    [nativeToScVal(fee_bps, { type: 'u32' })],
    { userId, transactionId, fee_bps }
  );
};

/**
 * @notice Computes the fee for a principal at the current fee_bps, mirroring the
 *         contract's calc_fee(principal): principal * bps / 10000.
 * @param {number|bigint} principal - Amount before fee.
 * @param {number|bigint} feeBps - Basis points (0–10000).
 * @returns {bigint} Truncated fee amount.
 */
const calcFee = (principal, feeBps) => {
  const p = BigInt(principal);
  const bps = BigInt(feeBps);

  if (p < 0n) {
    throw new BackstopServiceError(
      'principal must be non-negative',
      400,
      'BACKSTOP_INVALID_PRINCIPAL'
    );
  }

  if (bps < 0n || bps > BigInt(MAX_FEE_BPS)) {
    throw new BackstopServiceError(
      `fee_bps must be between 0 and ${MAX_FEE_BPS}`,
      400,
      'BACKSTOP_INVALID_FEE_BPS'
    );
  }

  return (p * bps) / 10000n;
};

module.exports = {
  BackstopServiceError,
  getConfig,
  getBalance,
  getVersion,
  depositFee,
  withdraw,
  setFeeBps,
  calcFee,
};
