const {
  TransactionBuilder,
  rpc,
  scValToNative,
} = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');
const { getRpcServer } = require('./stellar-service');
const { AppError } = require('../middleware/error-handler');
const { logger } = require('../utils/logger');

const STROOPS_PER_XLM = 10_000_000n;

const toBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return BigInt(value.trim());
  }
  return 0n;
};

const formatXlm = (stroops) => {
  const amount = toBigInt(stroops);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / STROOPS_PER_XLM;
  const fraction = abs % STROOPS_PER_XLM;
  const fractionText = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  const formatted = fractionText
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();

  return negative ? `-${formatted}` : formatted;
};

const extractResultValue = (simulation) => {
  const nativeValue = simulation?.result?.retval
    ? scValToNative(simulation.result.retval)
    : null;

  return nativeValue;
};

const simulateTransactionEstimate = async (transactionXdr) => {
  const env = getEnv();
  let transaction;

  try {
    transaction = TransactionBuilder.fromXDR(
      transactionXdr,
      env.NETWORK_PASSPHRASE
    );
  } catch (error) {
    throw new AppError(
      'Invalid transaction XDR',
      400,
      'INVALID_TRANSACTION_XDR'
    );
  }

  const server = getRpcServer();
  const simulation = await server.execute((rpcServer) =>
    rpcServer.simulateTransaction(transaction)
  );

  if (rpc.Api.isSimulationError(simulation)) {
    logger.warn('Transaction simulation failed', {
      error: simulation.error,
      latestLedger: simulation.latestLedger,
    });

    const error = new AppError(
      simulation.error || 'Transaction simulation failed',
      422,
      'SIMULATION_FAILED'
    );
    error.simulation = simulation;
    throw error;
  }

  const inclusionFeeStroops = toBigInt(transaction.fee);
  const resourceFeeStroops = toBigInt(simulation.minResourceFee || 0);
  const totalFeeStroops = inclusionFeeStroops + resourceFeeStroops;

  return {
    latestLedger: simulation.latestLedger,
    resourceUsage: {
      cpuInsns: simulation.cost?.cpuInsns || null,
      memBytes: simulation.cost?.memBytes || null,
    },
    execution: {
      result: extractResultValue(simulation),
      auth: simulation.result?.auth || [],
      events: simulation.events || [],
      stateChanges: simulation.stateChanges || [],
    },
    fees: {
      inclusionFeeStroops: inclusionFeeStroops.toString(),
      inclusionFeeXlm: formatXlm(inclusionFeeStroops),
      resourceFeeStroops: resourceFeeStroops.toString(),
      resourceFeeXlm: formatXlm(resourceFeeStroops),
      totalFeeStroops: totalFeeStroops.toString(),
      totalFeeXlm: formatXlm(totalFeeStroops),
    },
    transactionData: simulation.transactionData || null,
    restorePreamble: simulation.restorePreamble || null,
    raw: {
      minResourceFee: simulation.minResourceFee || null,
      cost: simulation.cost || null,
    },
  };
};

module.exports = {
  simulateTransactionEstimate,
  formatXlm,
};
