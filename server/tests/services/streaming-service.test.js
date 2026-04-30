describe('StreamingService factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      SOROBAN_RPC_URL: 'https://rpc.example.com',
      NETWORK_PASSPHRASE: 'Test Network',
      STREAMING_CONTRACT_ID: 'contract-1',
      STREAMING_TX_POLL_INTERVAL_MS: '1',
      STREAMING_TX_POLL_TIMEOUT_MS: '10',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const loadModule = () => {
    const serverFactory = jest.fn(() => ({
      getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS', hash: 'hash-1' }),
    }));

    jest.doMock('@stellar/stellar-sdk', () => ({
      Contract: jest.fn((contractId) => ({ contractId })),
      SorobanRpc: {
        Server: serverFactory,
      },
      TransactionBuilder: jest.fn(),
      Networks: {},
      BASE_FEE: '100',
      xdr: {
        Int128Parts: jest.fn(),
        Uint64: { fromString: jest.fn((value) => value) },
      },
    }));

    const StreamingService = require('../../services/streaming-service');
    return {
      StreamingService,
      serverFactory,
    };
  };

  it('reuses the singleton for identical configuration', () => {
    const { StreamingService, serverFactory } = loadModule();

    const first = StreamingService.getStreamingService();
    const second = StreamingService.getStreamingService();

    expect(first).toBe(second);
    expect(serverFactory).toHaveBeenCalledTimes(1);
  });

  it('creates a new singleton instance when configuration changes', () => {
    const { StreamingService, serverFactory } = loadModule();

    const first = StreamingService.getStreamingService();
    const second = StreamingService.getStreamingService({
      rpcUrl: 'https://rpc-2.example.com',
    });

    expect(second).not.toBe(first);
    expect(serverFactory).toHaveBeenCalledTimes(2);
  });

  it('pollTransaction respects configurable polling and returns once a transaction is found', async () => {
    const { StreamingService } = loadModule();
    const service = new StreamingService(
      'https://rpc.example.com',
      'Test Network',
      'contract-1',
      { pollIntervalMs: 1, pollTimeoutMs: 100 }
    );
    const getTransaction = jest
      .fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS', hash: 'hash-1' });

    service.server = { getTransaction };

    const result = await service.pollTransaction('hash-1');

    expect(result).toEqual({ status: 'SUCCESS', hash: 'hash-1' });
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });
});
