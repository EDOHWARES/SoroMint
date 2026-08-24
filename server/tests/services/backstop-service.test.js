/**
 * @title Backstop Service Tests
 * @description Tests the Backstop Soroban service layer. The @stellar/stellar-sdk
 *              module is mocked so no network access is required. Verifies
 *              response normalization, error mapping and — importantly — that
 *              every code path emits structured log entries carrying context
 *              such as userId / transactionId (no console.log).
 */

jest.mock('@stellar/stellar-sdk', () => {
  const rpcServerInstance = {
    simulateTransaction: jest.fn(),
    getAccount: jest.fn(),
    prepareTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
  };

  return {
    rpc: {
      Server: jest.fn(() => rpcServerInstance),
      Api: {
        isSimulationError: jest.fn(() => false),
      },
    },
    Keypair: {
      fromSecret: jest.fn(() => ({
        publicKey: () => ADMIN_PUBLIC_KEY,
      })),
    },
    Contract: jest.fn(function Contract(contractId) {
      this.contractId = contractId;
      this.call = jest.fn((method, ...args) => ({ method, args }));
    }),
    Address: jest.fn(function Address(value) {
      this.value = value;
      this.toScVal = () => ({ type: 'address', value });
    }),
    TransactionBuilder: jest.fn(function TransactionBuilder(source, opts) {
      this.source = source;
      this.opts = opts;
      this.addOperation = jest.fn(() => this);
      this.setTimeout = jest.fn(() => this);
      this.build = jest.fn(() => ({ built: true, source, opts }));
    }),
    nativeToScVal: jest.fn((value, opts) => ({
      type: opts && opts.type,
      value,
    })),
    scValToNative: jest.fn((scv) => scv),
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  };
});

const {
  rpc,
  scValToNative,
} = require('@stellar/stellar-sdk');
const {
  getConfig,
  getBalance,
  getVersion,
  depositFee,
  withdraw,
  setFeeBps,
  calcFee,
  BackstopServiceError,
} = require('../../services/backstop-service');
const { logger } = require('../../utils/logger');

const ADMIN_PUBLIC_KEY = 'GADMINPUBLICKEY0000000000000000000000000000000000000000000000000';
const TEST_CONTRACT_ID = 'CCONTRACT0000000000000000000000000000000000000000000000000000000000';
const OTHER_ADDRESS = 'GOTHER00000000000000000000000000000000000000000000000000000000000';

const rpcServer = rpc.Server();

beforeAll(() => {
  process.env.ADMIN_SECRET_KEY = 'SB...test-secret';
});

beforeEach(() => {
  jest.clearAllMocks();
  rpc.Api.isSimulationError.mockImplementation(() => false);
});

describe('Backstop Service - Reads', () => {
  it('getConfig normalizes the on-chain struct into named fields', async () => {
    scValToNative.mockReturnValue([
      ADMIN_PUBLIC_KEY,
      OTHER_ADDRESS,
      100,
      500000000n,
      10000n,
    ]);
    rpcServer.simulateTransaction.mockResolvedValue({
      results: [{ retval: 'xdr' }],
    });

    const config = await getConfig(TEST_CONTRACT_ID, { userId: 'u1', transactionId: 'tx1' });

    expect(config).toEqual({
      admin: ADMIN_PUBLIC_KEY,
      token: OTHER_ADDRESS,
      fee_bps: 100,
      total_deposited: '500000000',
      total_withdrawn: '10000',
    });

    expect(scValToNative).toHaveBeenCalledWith('xdr');
    expect(rpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('getConfig handles object-shaped results too', async () => {
    scValToNative.mockReturnValue({
      admin: ADMIN_PUBLIC_KEY,
      token: OTHER_ADDRESS,
      fee_bps: 25,
      total_deposited: 123n,
      total_withdrawn: 0n,
    });
    rpcServer.simulateTransaction.mockResolvedValue({
      results: [{ retval: 'xdr' }],
    });

    const config = await getConfig(TEST_CONTRACT_ID);

    expect(config.fee_bps).toBe(25);
    expect(config.total_deposited).toBe('123');
  });

  it('getConfig throws a structured BackstopServiceError on simulation failure', async () => {
    rpcServer.simulateTransaction.mockResolvedValue({
      error: 'HostError: bad',
    });
    rpc.Api.isSimulationError.mockReturnValue(true);

    await expect(getConfig(TEST_CONTRACT_ID)).rejects.toMatchObject({
      name: 'BackstopServiceError',
      code: 'BACKSTOP_SIMULATION_ERROR',
      statusCode: 502,
    });
  });

  it('getBalance returns the reserve balance as a string', async () => {
    scValToNative.mockReturnValue(1200000000n);
    rpcServer.simulateTransaction.mockResolvedValue({
      results: [{ retval: 'xdr' }],
    });

    const result = await getBalance(TEST_CONTRACT_ID);

    expect(result).toEqual({ balance: '1200000000' });
  });

  it('getVersion returns the contract version string', async () => {
    scValToNative.mockReturnValue('0.1.0');
    rpcServer.simulateTransaction.mockResolvedValue({
      results: [{ retval: 'xdr' }],
    });

    const result = await getVersion(TEST_CONTRACT_ID);

    expect(result).toEqual({ version: '0.1.0' });
  });
});

describe('Backstop Service - Writes', () => {
  const mockWritePipeline = () => {
    rpcServer.getAccount.mockResolvedValue({ id: ADMIN_PUBLIC_KEY });
    rpcServer.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
    rpcServer.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: '0xabc123',
    });
    rpcServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
  };

  it('depositFee signs and submits a deposit_fee transaction', async () => {
    mockWritePipeline();

    const result = await depositFee({
      contractId: TEST_CONTRACT_ID,
      from: ADMIN_PUBLIC_KEY,
      amount: 1000,
      userId: 'user-1',
      transactionId: 'tx-42',
    });

    expect(result).toEqual({ success: true, txHash: '0xabc123', status: 'SUCCESS' });
    expect(rpcServer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(rpcServer.getTransaction).toHaveBeenCalledWith('0xabc123');
  });

  it('depositFee rejects a `from` account that is not the server signer', async () => {
    await expect(
      depositFee({
        contractId: TEST_CONTRACT_ID,
        from: OTHER_ADDRESS,
        amount: 1000,
        userId: 'user-1',
        transactionId: 'tx-42',
      })
    ).rejects.toMatchObject({ code: 'BACKSTOP_FROM_MISMATCH', statusCode: 403 });
  });

  it('withdraw signs and submits a withdraw transaction', async () => {
    mockWritePipeline();

    const result = await withdraw({
      contractId: TEST_CONTRACT_ID,
      to: OTHER_ADDRESS,
      amount: 250,
      userId: 'user-2',
      transactionId: 'tx-43',
    });

    expect(result).toEqual({ success: true, txHash: '0xabc123', status: 'SUCCESS' });
  });

  it('setFeeBps signs and submits a set_fee_bps transaction', async () => {
    mockWritePipeline();

    const result = await setFeeBps({
      contractId: TEST_CONTRACT_ID,
      fee_bps: 50,
      userId: 'user-3',
      transactionId: 'tx-44',
    });

    expect(result).toEqual({ success: true, txHash: '0xabc123', status: 'SUCCESS' });
  });

  it('setFeeBps rejects fee_bps outside the 0–10000 range', async () => {
    await expect(
      setFeeBps({ contractId: TEST_CONTRACT_ID, fee_bps: 10001 })
    ).rejects.toMatchObject({ code: 'BACKSTOP_INVALID_FEE_BPS', statusCode: 400 });
  });

  it('withdraw surfaces submission rejections as structured errors', async () => {
    mockWritePipeline();
    rpcServer.sendTransaction.mockResolvedValue({
      status: 'ERROR',
      error: 'txn_bad_seq',
      hash: '0xreject',
    });

    await expect(
      withdraw({ contractId: TEST_CONTRACT_ID, to: OTHER_ADDRESS, amount: 1 })
    ).rejects.toMatchObject({ code: 'BACKSTOP_SUBMISSION_REJECTED', statusCode: 502 });
  });
});

describe('Backstop Service - Structured logging', () => {
  it('emits structured log payloads carrying userId and transactionId context', async () => {
    const infoSpy = jest.spyOn(logger, 'info');

    rpcServer.getAccount.mockResolvedValue({ id: ADMIN_PUBLIC_KEY });
    rpcServer.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
    rpcServer.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: '0xloggy',
    });
    rpcServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

    await depositFee({
      contractId: TEST_CONTRACT_ID,
      from: ADMIN_PUBLIC_KEY,
      amount: 500,
      userId: 'user-9',
      transactionId: 'tx-99',
    });

    const backstopLogs = infoSpy.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('Backstop')
    );

    expect(backstopLogs.length).toBeGreaterThan(0);

    for (const [message, payload] of backstopLogs) {
      expect(message).toEqual(expect.any(String));
      expect(payload).toMatchObject({
        contractId: TEST_CONTRACT_ID,
        userId: 'user-9',
        transactionId: 'tx-99',
      });
    }
  });
});

describe('Backstop Service - calcFee', () => {
  it('mirrors the contract fee computation principal * bps / 10000', () => {
    expect(calcFee(10000, 100)).toBe(100n);
    expect(calcFee(123456, 50)).toBe(617n);
    expect(calcFee(0, 100)).toBe(0n);
    expect(calcFee(999, 1)).toBe(0n);
  });

  it('rejects negative principals and out-of-range fee rates', () => {
    expect(() => calcFee(-1, 100)).toThrow(BackstopServiceError);
    expect(() => calcFee(100, -1)).toThrow(BackstopServiceError);
    expect(() => calcFee(100, 10001)).toThrow(BackstopServiceError);
  });
});

