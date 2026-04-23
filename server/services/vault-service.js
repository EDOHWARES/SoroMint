const { Contract, nativeToScVal, Address } = require('@stellar/stellar-sdk');
const { getRpcServer } = require('./stellar-service');
const Vault = require('../models/Vault');
const { logger } = require('../utils/logger');

class VaultService {
  async createVault(vaultContractId, user, collateralToken, collateralAmount, smtAmount) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    const vaultId = await rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call(
          'deposit_and_mint',
          nativeToScVal(Address.fromString(user), { type: 'address' }),
          nativeToScVal(Address.fromString(collateralToken), { type: 'address' }),
          nativeToScVal(collateralAmount, { type: 'i128' }),
          nativeToScVal(smtAmount, { type: 'i128' })
        )
      );
      
      return this.extractVaultIdFromResult(result);
    });

    const vault = new Vault({
      vaultId: vaultId.toString(),
      contractAddress: vaultContractId,
      owner: user,
      collaterals: [{
        tokenAddress: collateralToken,
        amount: collateralAmount.toString(),
      }],
      debt: smtAmount.toString(),
      status: 'active',
    });

    await vault.save();

    logger.info('Vault created', {
      vaultId,
      owner: user,
      collateralToken,
      collateralAmount,
      smtAmount,
    });

    return vault;
  }

  async addCollateral(vaultContractId, vaultId, collateralToken, amount) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    await rpcServer.execute(async (server) => {
      await server.simulateTransaction(
        contract.call(
          'add_collateral',
          nativeToScVal(parseInt(vaultId), { type: 'u64' }),
          nativeToScVal(Address.fromString(collateralToken), { type: 'address' }),
          nativeToScVal(amount, { type: 'i128' })
        )
      );
    });

    const vault = await Vault.findOne({ vaultId });
    if (vault) {
      const existingCollateral = vault.collaterals.find(c => c.tokenAddress === collateralToken);
      if (existingCollateral) {
        existingCollateral.amount = (BigInt(existingCollateral.amount) + BigInt(amount)).toString();
      } else {
        vault.collaterals.push({
          tokenAddress: collateralToken,
          amount: amount.toString(),
        });
      }
      vault.lastUpdated = new Date();
      await vault.save();
    }

    logger.info('Collateral added to vault', { vaultId, collateralToken, amount });

    return vault;
  }

  async mintMore(vaultContractId, vaultId, smtAmount) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    await rpcServer.execute(async (server) => {
      await server.simulateTransaction(
        contract.call(
          'mint_more',
          nativeToScVal(parseInt(vaultId), { type: 'u64' }),
          nativeToScVal(smtAmount, { type: 'i128' })
        )
      );
    });

    const vault = await Vault.findOne({ vaultId });
    if (vault) {
      vault.debt = (BigInt(vault.debt) + BigInt(smtAmount)).toString();
      vault.lastUpdated = new Date();
      await vault.save();
    }

    logger.info('Additional SMT minted', { vaultId, smtAmount });

    return vault;
  }

  async repayAndWithdraw(vaultContractId, vaultId, repayAmount, collateralToken, withdrawAmount) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    await rpcServer.execute(async (server) => {
      await server.simulateTransaction(
        contract.call(
          'repay_and_withdraw',
          nativeToScVal(parseInt(vaultId), { type: 'u64' }),
          nativeToScVal(repayAmount, { type: 'i128' }),
          nativeToScVal(Address.fromString(collateralToken), { type: 'address' }),
          nativeToScVal(withdrawAmount, { type: 'i128' })
        )
      );
    });

    const vault = await Vault.findOne({ vaultId });
    if (vault) {
      if (repayAmount > 0) {
        vault.debt = (BigInt(vault.debt) - BigInt(repayAmount)).toString();
      }
      
      if (withdrawAmount > 0) {
        const collateral = vault.collaterals.find(c => c.tokenAddress === collateralToken);
        if (collateral) {
          collateral.amount = (BigInt(collateral.amount) - BigInt(withdrawAmount)).toString();
        }
      }

      if (vault.debt === '0') {
        vault.status = 'closed';
      }

      vault.lastUpdated = new Date();
      await vault.save();
    }

    logger.info('Vault repay and withdraw', { vaultId, repayAmount, withdrawAmount });

    return vault;
  }

  async liquidate(vaultContractId, vaultId, liquidator, debtToCover) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    await rpcServer.execute(async (server) => {
      await server.simulateTransaction(
        contract.call(
          'liquidate',
          nativeToScVal(parseInt(vaultId), { type: 'u64' }),
          nativeToScVal(Address.fromString(liquidator), { type: 'address' }),
          nativeToScVal(debtToCover, { type: 'i128' })
        )
      );
    });

    const vault = await Vault.findOne({ vaultId });
    if (vault) {
      vault.debt = (BigInt(vault.debt) - BigInt(debtToCover)).toString();
      vault.liquidationHistory.push({
        liquidator,
        debtCovered: debtToCover.toString(),
        timestamp: new Date(),
      });

      if (vault.debt === '0') {
        vault.status = 'liquidated';
      }

      vault.lastUpdated = new Date();
      await vault.save();
    }

    logger.info('Vault liquidated', { vaultId, liquidator, debtToCover });

    return vault;
  }

  async getVault(vaultContractId, vaultId) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    const vaultData = await rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call('get_vault', nativeToScVal(parseInt(vaultId), { type: 'u64' }))
      );
      return this.parseVaultData(result);
    });

    return vaultData;
  }

  async getVaultHealth(vaultContractId, vaultId) {
    const rpcServer = getRpcServer();
    const contract = new Contract(vaultContractId);
    
    const health = await rpcServer.execute(async (server) => {
      const result = await server.simulateTransaction(
        contract.call('get_vault_health', nativeToScVal(parseInt(vaultId), { type: 'u64' }))
      );
      return this.extractI128FromResult(result);
    });

    return health;
  }

  async getUserVaults(vaultContractId, userAddress) {
    return Vault.find({ 
      contractAddress: vaultContractId,
      owner: userAddress,
      status: { $in: ['active', 'liquidated'] }
    }).sort({ createdAt: -1 });
  }

  async getLiquidatableVaults(vaultContractId, liquidationThreshold = 130) {
    return Vault.find({
      contractAddress: vaultContractId,
      status: 'active',
      collateralizationRatio: { $lt: liquidationThreshold }
    }).sort({ collateralizationRatio: 1 });
  }

  async updateVaultHealth(vaultId, collateralizationRatio) {
    const vault = await Vault.findOne({ vaultId });
    if (vault) {
      vault.collateralizationRatio = collateralizationRatio;
      vault.lastUpdated = new Date();
      await vault.save();
    }
    return vault;
  }

  extractVaultIdFromResult(result) {
    return 1;
  }

  parseVaultData(result) {
    return {};
  }

  extractI128FromResult(result) {
    return 0;
  }
}

module.exports = new VaultService();
