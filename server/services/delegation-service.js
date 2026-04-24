const Delegation = require('../models/Delegation');
const { invokeContract } = require('./stellar-service');

class DelegationService {
  /**
   * Approve a minter delegation on-chain and track off-chain
   */
  async approveMinter(tokenContractId, owner, delegate, limit, sponsor = null) {
    try {
      // Invoke contract to approve minter
      const result = await invokeContract(tokenContractId, 'approve_minter', {
        owner,
        delegate,
        limit: limit.toString(),
        sponsor: sponsor || null,
      });

      // Track delegation off-chain
      const delegation = await Delegation.findByTokenOwnerDelegate(tokenContractId, owner, delegate);
      
      if (delegation) {
        // Update existing delegation
        delegation.limit = limit.toString();
        delegation.sponsor = sponsor;
        delegation.status = 'active';
        delegation.revokedAt = null;
        await delegation.save();
      } else {
        // Create new delegation
        await Delegation.create({
          tokenContractId,
          owner,
          delegate,
          limit: limit.toString(),
          minted: '0',
          sponsor,
          status: 'active',
        });
      }

      return {
        success: true,
        txHash: result.txHash,
        message: `Delegation approved: ${delegate} can mint up to ${limit} tokens on behalf of ${owner}`,
      };
    } catch (error) {
      throw new Error(`Failed to approve minter: ${error.message}`);
    }
  }

  /**
   * Revoke a minter delegation on-chain and update off-chain
   */
  async revokeMinter(tokenContractId, owner, delegate) {
    try {
      // Invoke contract to revoke minter
      const result = await invokeContract(tokenContractId, 'revoke_minter', {
        owner,
        delegate,
      });

      // Update delegation off-chain
      const delegation = await Delegation.findByTokenOwnerDelegate(tokenContractId, owner, delegate);
      if (delegation) {
        await delegation.revoke();
      }

      return {
        success: true,
        txHash: result.txHash,
        message: `Delegation revoked: ${delegate} can no longer mint on behalf of ${owner}`,
      };
    } catch (error) {
      throw new Error(`Failed to revoke minter: ${error.message}`);
    }
  }

  /**
   * Execute a delegated mint on-chain and track off-chain
   */
  async delegateMint(tokenContractId, delegate, owner, to, amount) {
    try {
      // Invoke contract to execute delegated mint
      const result = await invokeContract(tokenContractId, 'delegate_mint', {
        delegate,
        owner,
        to,
        amount: amount.toString(),
      });

      // Update delegation off-chain
      const delegation = await Delegation.findByTokenOwnerDelegate(tokenContractId, owner, delegate);
      if (delegation) {
        const newMinted = (BigInt(delegation.minted) + BigInt(amount)).toString();
        await delegation.updateMinted(newMinted);
      }

      return {
        success: true,
        txHash: result.txHash,
        message: `Delegated mint executed: ${amount} tokens minted to ${to}`,
      };
    } catch (error) {
      throw new Error(`Failed to execute delegated mint: ${error.message}`);
    }
  }

  /**
   * Query delegation details from contract
   */
  async getDelegation(tokenContractId, owner, delegate) {
    try {
      // Query contract for delegation details
      const result = await invokeContract(tokenContractId, 'mint_delegate', {
        owner,
        delegate,
      });

      // Also get off-chain tracking
      const offChainDelegation = await Delegation.findByTokenOwnerDelegate(
        tokenContractId,
        owner,
        delegate
      );

      return {
        onChain: result,
        offChain: offChainDelegation,
      };
    } catch (error) {
      throw new Error(`Failed to get delegation: ${error.message}`);
    }
  }

  /**
   * Get all delegations for an owner
   */
  async getDelegationsByOwner(tokenContractId, owner) {
    try {
      return await Delegation.findByTokenAndOwner(tokenContractId, owner);
    } catch (error) {
      throw new Error(`Failed to get delegations by owner: ${error.message}`);
    }
  }

  /**
   * Get all delegations for a delegate
   */
  async getDelegationsByDelegate(tokenContractId, delegate) {
    try {
      return await Delegation.findByTokenAndDelegate(tokenContractId, delegate);
    } catch (error) {
      throw new Error(`Failed to get delegations by delegate: ${error.message}`);
    }
  }

  /**
   * Get all active delegations for a token
   */
  async getActiveDelegations(tokenContractId) {
    try {
      return await Delegation.find({ tokenContractId, status: 'active' });
    } catch (error) {
      throw new Error(`Failed to get active delegations: ${error.message}`);
    }
  }

  /**
   * Get delegation statistics
   */
  async getDelegationStats(tokenContractId) {
    try {
      const stats = await Delegation.aggregate([
        { $match: { tokenContractId } },
        {
          $group: {
            _id: null,
            totalDelegations: { $sum: 1 },
            activeDelegations: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
            },
            revokedDelegations: {
              $sum: { $cond: [{ $eq: ['$status', 'revoked'] }, 1, 0] },
            },
            exhaustedDelegations: {
              $sum: { $cond: [{ $eq: ['$status', 'exhausted'] }, 1, 0] },
            },
            totalLimitBN: { $sum: '$limit' },
            totalMintedBN: { $sum: '$minted' },
            delegationsWithSponsor: {
              $sum: { $cond: [{ $ne: ['$sponsor', null] }, 1, 0] },
            },
          },
        },
      ]);

      return stats[0] || {
        totalDelegations: 0,
        activeDelegations: 0,
        revokedDelegations: 0,
        exhaustedDelegations: 0,
        totalLimitBN: 0,
        totalMintedBN: 0,
        delegationsWithSponsor: 0,
      };
    } catch (error) {
      throw new Error(`Failed to get delegation stats: ${error.message}`);
    }
  }

  /**
   * Check if a delegation can mint a specific amount
   */
  async canMint(tokenContractId, owner, delegate, amount) {
    try {
      const delegation = await Delegation.findByTokenOwnerDelegate(
        tokenContractId,
        owner,
        delegate
      );

      if (!delegation) {
        return { canMint: false, reason: 'Delegation not found' };
      }

      if (delegation.status !== 'active') {
        return { canMint: false, reason: `Delegation is ${delegation.status}` };
      }

      if (!delegation.canMint(amount)) {
        return {
          canMint: false,
          reason: 'Mint amount exceeds remaining limit',
          remaining: delegation.getRemainingLimit(),
        };
      }

      return { canMint: true };
    } catch (error) {
      throw new Error(`Failed to check if can mint: ${error.message}`);
    }
  }
}

module.exports = new DelegationService();
