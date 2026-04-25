const PlatformFee = require('../models/PlatformFee');
const Stream = require('../models/Stream');
const PlatformFeeConfig = require('../models/PlatformFeeConfig');

class PlatformFeeService {
  constructor() {
    this.defaultFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.01; // 1% default
  }

  async getFeeConfig(tokenAddress) {
    try {
      const config = await PlatformFeeConfig.findOne({ 
        tokenAddress, 
        isActive: true 
      });
      return config ? config.feePercentage : this.defaultFeePercentage;
    } catch (error) {
      return this.defaultFeePercentage;
    }
  }

  async calculateFee(totalAmount, tokenAddress, feePercentage = null) {
    let percentage = feePercentage;
    if (!percentage && tokenAddress) {
      percentage = await this.getFeeConfig(tokenAddress);
    } else if (!percentage) {
      percentage = this.defaultFeePercentage;
    }

    const bigTotal = BigInt(totalAmount);
    const fee = (bigTotal * BigInt(Math.floor(percentage * 10000))) / 10000n;
    
    // Apply min/max fee constraints if configured
    if (tokenAddress) {
      try {
        const config = await PlatformFeeConfig.findOne({ 
          tokenAddress, 
          isActive: true 
        });
        
        if (config) {
          const feeBigInt = BigInt(fee.toString());
          const minFee = BigInt(config.minFeeAmount || '0');
          const maxFee = config.maxFeeAmount ? BigInt(config.maxFeeAmount) : null;
          
          if (feeBigInt < minFee) {
            return minFee.toString();
          }
          if (maxFee && feeBigInt > maxFee) {
            return maxFee.toString();
          }
        }
      } catch (error) {
        // Continue with calculated fee if config lookup fails
      }
    }
    
    return fee.toString();
  }

  async createPlatformFeeRecord(streamData, txHash) {
    const feeAmount = await this.calculateFee(streamData.totalAmount, streamData.tokenAddress);
    const feePercentage = await this.getFeeConfig(streamData.tokenAddress);

    const platformFee = new PlatformFee({
      streamId: streamData.streamId,
      feeAmount,
      feePercentage,
      streamTotalAmount: streamData.totalAmount,
      tokenAddress: streamData.tokenAddress,
      collectionTxHash: txHash,
      status: 'collected',
    });

    await platformFee.save();
    return platformFee;
  }

  async updateStreamWithFeeInfo(streamId, feeAmount, feePercentage) {
    await Stream.updateOne(
      { streamId },
      { 
        platformFeeAmount: feeAmount,
        platformFeePercentage: feePercentage
      }
    );
  }

  async getCollectedFees(tokenAddress = null, status = 'collected') {
    const query = { status };
    if (tokenAddress) {
      query.tokenAddress = tokenAddress;
    }

    const fees = await PlatformFee.find(query)
      .sort({ createdAt: -1 });

    const totalCollected = fees.reduce((sum, fee) => {
      return sum + BigInt(fee.feeAmount);
    }, 0n);

    return {
      fees,
      totalCollected: totalCollected.toString(),
      count: fees.length,
    };
  }

  async withdrawFees(adminAddress, tokenAddress, amount = null) {
    const query = { 
      status: 'collected',
      tokenAddress 
    };

    if (amount) {
      // Select specific fees up to the requested amount
      const availableFees = await PlatformFee.find(query).sort({ createdAt: 1 });
      let selectedFees = [];
      let totalAmount = 0n;

      for (const fee of availableFees) {
        if (totalAmount >= BigInt(amount)) break;
        selectedFees.push(fee);
        totalAmount += BigInt(fee.feeAmount);
      }

      if (totalAmount < BigInt(amount)) {
        throw new Error('Insufficient collected fees for withdrawal');
      }

      return selectedFees;
    } else {
      // Withdraw all available fees
      return await PlatformFee.find(query).sort({ createdAt: 1 });
    }
  }

  async markFeesAsWithdrawn(feeIds, txHash, withdrawnBy) {
    await PlatformFee.updateMany(
      { _id: { $in: feeIds } },
      {
        status: 'withdrawn',
        withdrawnTxHash: txHash,
        withdrawnAt: new Date(),
        withdrawnBy,
      }
    );
  }

  async getFeeStatistics() {
    const stats = await PlatformFee.aggregate([
      {
        $group: {
          _id: '$tokenAddress',
          totalCollected: { $sum: '$feeAmount' },
          totalWithdrawn: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'withdrawn'] }, '$withdrawnAmount', '0'] 
            } 
          },
          pendingWithdrawal: {
            $sum: {
              $cond: [{ $eq: ['$status', 'collected'] }, '$feeAmount', '0']
            }
          },
          count: { $sum: 1 },
        }
      }
    ]);

    return stats.map(stat => ({
      tokenAddress: stat._id,
      totalCollected: stat.totalCollected,
      totalWithdrawn: stat.totalWithdrawn,
      pendingWithdrawal: stat.pendingWithdrawal,
      count: stat.count,
    }));
  }
}

module.exports = PlatformFeeService;
