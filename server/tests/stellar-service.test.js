const { getRpcServer, wrapAsset, deployStellarAssetContract } = require('../services/stellar-service');

describe('Stellar Service', () => {
  it('should return an RPC server instance', () => {
    process.env.SOROBAN_RPC_URL = 'https://localhost:8000';
    const server = getRpcServer();
    expect(server).toBeDefined();
    expect(server.urls).toBeDefined();
  });

  it('should wrap XLM asset correctly', async () => {
    const asset = await wrapAsset('XLM');
    expect(asset.isNative()).toBe(true);
  });

  it('should wrap custom asset correctly', async () => {
    // Valid stellar address format G...
    const mockIssuer = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
    const asset = await wrapAsset('USDC', mockIssuer);
    expect(asset.isNative()).toBe(false);
    expect(asset.code).toBe('USDC');
    expect(asset.issuer).toBe(mockIssuer);
  });

  it('should deploy custom stellar asset contract', async () => {
    const result = await deployStellarAssetContract('hash', 'salt', 'account');
    expect(result.status).toBe('pending');
    expect(result.contractId).toBeDefined();
  });
});
