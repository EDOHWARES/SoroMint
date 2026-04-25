const { SorobanRpc, Keypair, Transaction, Networks, xdr, Contract, StrKey, Account, Address } = require('@stellar/stellar-sdk');
const StreamingService = require('../../services/streaming-service');

jest.mock('../../models/Stream', () => ({
  create: jest.fn().mockResolvedValue({}),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

const Stream = require('../../models/Stream');

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn(),
        prepareTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getLedgerEntries: jest.fn(),
        simulateTransaction: jest.fn(),
        getTransaction: jest.fn(),
      })),
    },
  };
});

describe('StreamingService', () => {
  let streamingService;
  let mockServer;
  const rpcUrl = 'https://rpc.stellar.org';
  const networkPassphrase = Networks.TESTNET;
  // Valid Soroban contract ID
  const contractId = StrKey.encodeContract(Buffer.alloc(32));
  const sourceKeypair = Keypair.random();
  const sender = '0'.repeat(64); // 32 bytes hex
  const recipient = '0'.repeat(64); // 32 bytes hex
  const tokenAddress = '0'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    jest.clearAllMocks();
    streamingService = new StreamingService(rpcUrl, networkPassphrase);
    mockServer = streamingService.server;
  });

  describe('createStream', () => {
    test('should successfully create a stream', async () => {
      const sourceAccount = new Account(sourceKeypair.publicKey(), '1');
      mockServer.getAccount.mockResolvedValue(sourceAccount);
      
      const mockTx = { sign: jest.fn(), hash: () => 'tx_hash' };
      mockServer.prepareTransaction.mockResolvedValue(mockTx);
      mockServer.sendTransaction.mockResolvedValue({ hash: 'tx_hash' });
      
      // Mock getTransaction for pollTransaction
      mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS', resultMetaXdr: 'AAAA' });
      // Mock decodeStreamIdFromResult to avoid null error
      jest.spyOn(streamingService, 'decodeStreamIdFromResult').mockReturnValue(1);

      const result = await streamingService.createStream(
        contractId,
        sourceKeypair,
        '00'.repeat(32), // Mock hex sender
        '00'.repeat(32), // Mock hex recipient
        '00'.repeat(32), // Mock hex token
        1000,
        100,
        200,
        true
      );

      expect(mockServer.getAccount).toHaveBeenCalledWith(sourceKeypair.publicKey());
      expect(mockServer.prepareTransaction).toHaveBeenCalled();
      expect(mockTx.sign).toHaveBeenCalledWith(sourceKeypair);
      expect(mockServer.sendTransaction).toHaveBeenCalledWith(mockTx);
      expect(result.status).toBe('SUCCESS');
      expect(Stream.create).toHaveBeenCalled();
    });

    test('should handle zero amounts in createStream', async () => {
        mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
        mockServer.prepareTransaction.mockResolvedValue({ sign: jest.fn(), hash: () => 'h' });
        mockServer.sendTransaction.mockResolvedValue({ hash: 'h' });
        mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
        // Mock decodeStreamIdFromResult
        jest.spyOn(streamingService, 'decodeStreamIdFromResult').mockReturnValue(2);

        const result = await streamingService.createStream(
            contractId, sourceKeypair, '00'.repeat(32), '00'.repeat(32), '00'.repeat(32), 
            0, 100, 200
        );
        expect(result.status).toBe('SUCCESS');
    });
  });

  describe('withdraw', () => {
    test('should successfully withdraw from a stream', async () => {
      mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
      mockServer.prepareTransaction.mockResolvedValue({ sign: jest.fn(), hash: () => 'h' });
      mockServer.sendTransaction.mockResolvedValue({ hash: 'h' });
      mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const result = await streamingService.withdraw(contractId, sourceKeypair, 1, 500);

      expect(mockServer.sendTransaction).toHaveBeenCalled();
      expect(result.status).toBe('SUCCESS');
    });

    test('should handle zero amount withdrawal', async () => {
        mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
        mockServer.prepareTransaction.mockResolvedValue({ sign: jest.fn(), hash: () => 'h' });
        mockServer.sendTransaction.mockResolvedValue({ hash: 'h' });
        mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

        const result = await streamingService.withdraw(contractId, sourceKeypair, 1, 0);
        expect(result.status).toBe('SUCCESS');
    });
  });

  describe('cancelStream', () => {
    test('should successfully cancel a stream', async () => {
      mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
      mockServer.prepareTransaction.mockResolvedValue({ sign: jest.fn(), hash: () => 'h' });
      mockServer.sendTransaction.mockResolvedValue({ hash: 'h' });
      mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const result = await streamingService.cancelStream(contractId, sourceKeypair, 1);

      expect(mockServer.sendTransaction).toHaveBeenCalled();
      expect(result.status).toBe('SUCCESS');
    });
  });

  describe('getStreamBalance', () => {
    test('should fetch and parse stream balance', async () => {
      mockServer.getLedgerEntries.mockResolvedValue({
        entries: [{ xdr: 'mock_base64' }]
      });
      
      const mockAddress = { toString: () => 'ADDR' };
      const mockVal = (v) => ({ address: () => mockAddress, i128: () => v, u32: () => v, b: () => v });
      const mockMap = [
        { key: () => ({ symbol: () => 'sender' }), val: () => mockVal('S') },
        { key: () => ({ symbol: () => 'recipient' }), val: () => mockVal('R') },
        { key: () => ({ symbol: () => 'token' }), val: () => mockVal('T') },
        { key: () => ({ symbol: () => 'rate_per_ledger' }), val: () => mockVal(10) },
        { key: () => ({ symbol: () => 'start_ledger' }), val: () => mockVal(100) },
        { key: () => ({ symbol: () => 'stop_ledger' }), val: () => mockVal(200) },
        { key: () => ({ symbol: () => 'withdrawn' }), val: () => mockVal(0) },
        { key: () => ({ symbol: () => 'is_public' }), val: () => mockVal(true) },
      ];

      const fromXdrMock = jest.spyOn(xdr.LedgerEntryData, 'fromXDR').mockReturnValue({
        value: () => ({ val: () => ({ map: () => mockMap }) })
      });

      const result = await streamingService.getStreamBalance(contractId, 1);
      expect(result).toBeDefined();
      expect(result.sender).toBe('ADDR');
      fromXdrMock.mockRestore();
    });

    test('should return null if stream not found', async () => {
      mockServer.getLedgerEntries.mockResolvedValue({ entries: [] });
      const result = await streamingService.getStreamBalance(contractId, 999);
      expect(result).toBeNull();
    });
  });

  describe('getStream', () => {
    test('should fetch and parse stream data via simulation', async () => {
      mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
      
      const mockAddress = { toString: () => 'ADDR' };
      const mockVal = (v) => ({ address: () => mockAddress, i128: () => v, u32: () => v, b: () => v });
      const mockMap = [
        { key: () => ({ symbol: () => 'sender' }), val: () => mockVal('S') },
        { key: () => ({ symbol: () => 'recipient' }), val: () => mockVal('R') },
        { key: () => ({ symbol: () => 'token' }), val: () => mockVal('T') },
        { key: () => ({ symbol: () => 'is_public' }), val: () => mockVal(true) },
      ];

      mockServer.simulateTransaction.mockResolvedValue({
        result: { retval: { map: () => mockMap } }
      });

      const result = await streamingService.getStream(contractId, 1);
      expect(result).toBeDefined();
      expect(result.sender).toBe('ADDR');
    });
  describe('decodeStreamIdFromResult', () => {
    test('should return null if no resultMetaXdr', () => {
      expect(streamingService.decodeStreamIdFromResult({})).toBeNull();
    });

    test('should return null if no created event found', () => {
      const mockMeta = {
        v3: () => ({
          sorobanMeta: () => ({
            events: () => []
          })
        })
      };
      const fromXdrMock = jest.spyOn(xdr.TransactionMeta, 'fromXDR').mockReturnValue(mockMeta);
      expect(streamingService.decodeStreamIdFromResult({ resultMetaXdr: 'AAAA' })).toBeNull();
      fromXdrMock.mockRestore();
    });
  });

    test('should return null if simulation fails', async () => {
      mockServer.getAccount.mockResolvedValue(new Account(sourceKeypair.publicKey(), '1'));
      mockServer.simulateTransaction.mockResolvedValue({});

      const result = await streamingService.getStream(contractId, 1);
      expect(result).toBeNull();
    });
  });

  describe('pollTransaction', () => {
    test('should timeout if transaction not found within limit', async () => {
      mockServer.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });
      
      // Speed up the test by reducing timeout and interval
      await expect(streamingService.pollTransaction('h', 100)).rejects.toThrow('Transaction polling timeout');
    });

    test('should succeed if transaction found on second poll', async () => {
      mockServer.getTransaction
        .mockResolvedValueOnce({ status: 'NOT_FOUND' })
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      // Use a small delay in the real code so we don't have to wait 1s in tests
      // or we can mock global.setTimeout
      jest.useFakeTimers();
      const pollPromise = streamingService.pollTransaction('h');
      
      // Advance timers to trigger the retry
      await jest.advanceTimersByTimeAsync(1000);
      
      const result = await pollPromise;
      expect(result.status).toBe('SUCCESS');
      jest.useRealTimers();
    });
  });

  describe('edge cases and errors', () => {
    test('should handle network timeout during RPC call', async () => {
      mockServer.getAccount.mockRejectedValue(new Error('Network Timeout'));
      
      await expect(streamingService.createStream(
        contractId, sourceKeypair, '0'.repeat(64), '0'.repeat(64), '0'.repeat(64), 1000, 100, 200
      )).rejects.toThrow('Network Timeout');
    });

    test('should handle invalid contract ID hex in createStream', async () => {
        // This test checks if Buffer.from throws or if the SDK throws
        // If we pass an invalid hex, Buffer.from might just return an empty/partial buffer
        // but let's see if we can trigger an error.
        await expect(streamingService.createStream(
            contractId, sourceKeypair, 'invalid-hex', 'invalid-hex', 'invalid-hex', 1000, 100, 200
        )).rejects.toThrow();
    });
  });
});
