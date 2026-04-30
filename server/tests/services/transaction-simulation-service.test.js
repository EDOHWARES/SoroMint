const mockSimulateTransaction = jest.fn();
const mockGetAccount = jest.fn();

jest.doMock('@stellar/stellar-sdk', () => ({
  TransactionBuilder: {
    fromXDR: jest.fn(),
  },
  rpc: {
    Api: {
      isSimulationError: jest.fn(),
    },
  },
  scValToNative: jest.fn(),
}));

jest.mock('../../config/env-config', () => ({
  getEnv: jest.fn(),
}));

jest.mock('../../services/stellar-service', () => ({
  getRpcServer: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { AppError } = require('../../middleware/error-handler');
const { getEnv } = require('../../config/env-config');
const { getRpcServer } = require('../../services/stellar-service');
const {
  TransactionBuilder,
  rpc,
  scValToNative,
} = require('@stellar/stellar-sdk');
const {
  simulateTransactionEstimate,
  formatXlm,
} = require('../../services/transaction-simulation-service');

describe('transaction-simulation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getEnv.mockReturnValue({
      NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    });
    TransactionBuilder.fromXDR.mockReturnValue({
      fee: '100',
    });
    scValToNative.mockReturnValue({ ok: true });
    rpc.Api.isSimulationError.mockReturnValue(false);
    getRpcServer.mockReturnValue({
      execute: jest.fn().mockImplementation(async (fn) =>
        fn({
          simulateTransaction: mockSimulateTransaction.mockResolvedValue({
            latestLedger: 12345,
            minResourceFee: '2500',
            cost: {
              cpuInsns: '1200000',
              memBytes: '4096',
            },
            result: {
              retval: { fake: true },
              auth: ['auth-entry'],
            },
            events: ['event-xdr'],
            stateChanges: ['state-xdr'],
            transactionData: 'tx-data-xdr',
          }),
        })
      ),
    });
  });

  it('formats stroops as XLM strings', () => {
    expect(formatXlm(100)).toBe('0.00001');
    expect(formatXlm(2600)).toBe('0.00026');
  });

  it('simulates a transaction and returns fee estimates', async () => {
    const result = await simulateTransactionEstimate('AAAAAg==');

    expect(TransactionBuilder.fromXDR).toHaveBeenCalledWith(
      'AAAAAg==',
      'Test SDF Network ; September 2015'
    );
    expect(result.fees.totalFeeXlm).toBe('0.00026');
    expect(result.resourceUsage.cpuInsns).toBe('1200000');
    expect(result.execution.result).toEqual({ ok: true });
    expect(getRpcServer).toHaveBeenCalled();
  });

  it('rejects invalid transaction XDR', async () => {
    TransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error('bad xdr');
    });

    await expect(simulateTransactionEstimate('bad-xdr')).rejects.toBeInstanceOf(
      AppError
    );
  });
});
