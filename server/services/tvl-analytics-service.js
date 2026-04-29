/**
 * @title Real-time TVL Analytics Service
 * @description Calculates Total Value Locked and platform metrics
 * @notice Aggregates active streams and provides cached results
 */

const Stream = require('../models/Stream');
const Token = require('../models/Token');
const { getCacheService } = require('./cache-service');
const { logger } = require('../utils/logger');

const CACHE_TTL = 30; // 30 seconds for TVL data
const CACHE_KEY_TVL = 'analytics:tvl:total';
const CACHE_KEY_STREAMS = 'analytics:streams:active';
const CACHE_KEY_TOKENS = 'analytics:tokens:count';
const CACHE_KEY_VOLUME = 'analytics:volume:24h';

class TVLAnalyticsService {
  /**
   * Calculate total value locked across all active streams
   * @returns {Promise<Object>} TVL data with cached results
   */
  async calculateTVL() {
    try {
      const cache = getCacheService();
      const cacheKey = CACHE_KEY_TVL;

      // Try to get from cache
      if (cache.isConnected) {
        try {
          const cached = await cache.get(cacheKey);
          if (cached) {
            logger.debug('TVL data retrieved from cache');
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          logger.warn('Cache retrieval failed, computing TVL', { error: cacheError.message });
        }
      }

      // Calculate from database
      const tvlData = await this._computeTVL();

      // Store in cache
      if (cache.isConnected) {
        try {
          await cache.set(cacheKey, JSON.stringify(tvlData), { EX: CACHE_TTL });
        } catch (cacheError) {
          logger.warn('Cache set failed', { error: cacheError.message });
        }
      }

      return tvlData;
    } catch (error) {
      logger.error('Error calculating TVL', { error: error.message });
      throw error;
    }
  }

  /**
   * Internal method to compute TVL from database
   * @private
   */
  async _computeTVL() {
    // Aggregate active streams by token
    const tvlByToken = await Stream.aggregate([
      {
        $match: {
          status: 'active',
        },
      },
      {
        $group: {
          _id: '$tokenAddress',
          totalAmount: {
            $sum: { $toDouble: '$totalAmount' },
          },
          streamCount: { $sum: 1 },
          avgAmount: {
            $avg: { $toDouble: '$totalAmount' },
          },
        },
      },
      {
        $sort: { totalAmount: -1 },
      },
    ]);

    // Calculate total TVL
    const totalTVL = tvlByToken.reduce((sum, item) => sum + item.totalAmount, 0);

    // Get total active streams
    const activeStreamCount = await Stream.countDocuments({ status: 'active' });

    return {
      timestamp: new Date().toISOString(),
      totalValueLocked: totalTVL,
      totalValueLockedFormatted: this._formatNumber(totalTVL),
      activeStreamCount,
      tvlByToken: tvlByToken.map((token) => ({
        tokenAddress: token._id,
        totalAmount: token.totalAmount,
        totalAmountFormatted: this._formatNumber(token.totalAmount),
        streamCount: token.streamCount,
        averageAmount: token.avgAmount,
        averageAmountFormatted: this._formatNumber(token.avgAmount),
      })),
      topTokens: tvlByToken.slice(0, 5),
    };
  }

  /**
   * Get active stream metrics
   * @returns {Promise<Object>} Stream metrics
   */
  async getStreamMetrics() {
    try {
      const cache = getCacheService();
      const cacheKey = CACHE_KEY_STREAMS;

      // Try to get from cache
      if (cache.isConnected) {
        try {
          const cached = await cache.get(cacheKey);
          if (cached) {
            logger.debug('Stream metrics retrieved from cache');
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          logger.warn('Cache retrieval failed', { error: cacheError.message });
        }
      }

      // Calculate from database
      const metrics = await this._computeStreamMetrics();

      // Store in cache
      if (cache.isConnected) {
        try {
          await cache.set(cacheKey, JSON.stringify(metrics), { EX: CACHE_TTL });
        } catch (cacheError) {
          logger.warn('Cache set failed', { error: cacheError.message });
        }
      }

      return metrics;
    } catch (error) {
      logger.error('Error getting stream metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Internal method to compute stream metrics
   * @private
   */
  async _computeStreamMetrics() {
    const streamStats = await Stream.aggregate([
      {
        $facet: {
          active: [
            { $match: { status: 'active' } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                totalValue: { $sum: { $toDouble: '$totalAmount' } },
              },
            },
          ],
          completed: [
            { $match: { status: 'completed' } },
            { $count: 'count' },
          ],
          canceled: [
            { $match: { status: 'canceled' } },
            { $count: 'count' },
          ],
          recentlyCreated: [
            { $match: { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const stats = streamStats[0];

    return {
      timestamp: new Date().toISOString(),
      active: {
        count: stats.active[0]?.count || 0,
        totalValue: stats.active[0]?.totalValue || 0,
        totalValueFormatted: this._formatNumber(stats.active[0]?.totalValue || 0),
      },
      completed: {
        count: stats.completed[0]?.count || 0,
      },
      canceled: {
        count: stats.canceled[0]?.count || 0,
      },
      recentlyCreated24h: stats.recentlyCreated[0]?.count || 0,
      total: {
        count:
          (stats.active[0]?.count || 0) +
          (stats.completed[0]?.count || 0) +
          (stats.canceled[0]?.count || 0),
      },
    };
  }

  /**
   * Get overall platform metrics
   * @returns {Promise<Object>} Platform metrics
   */
  async getPlatformMetrics() {
    try {
      const tvl = await this.calculateTVL();
      const streams = await this.getStreamMetrics();

      // Get token count
      const tokenCount = await Token.countDocuments({});

      return {
        timestamp: new Date().toISOString(),
        tvl: {
          total: tvl.totalTVL,
          formatted: tvl.totalValueLockedFormatted,
          byToken: tvl.tvlByToken,
        },
        streams: streams,
        tokens: {
          total: tokenCount,
        },
      };
    } catch (error) {
      logger.error('Error getting platform metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get 24-hour volume metrics
   * @returns {Promise<Object>} Volume metrics
   */
  async get24HourVolume() {
    try {
      const cache = getCacheService();
      const cacheKey = CACHE_KEY_VOLUME;

      // Try to get from cache
      if (cache.isConnected) {
        try {
          const cached = await cache.get(cacheKey);
          if (cached) {
            logger.debug('24h volume retrieved from cache');
            return JSON.parse(cached);
          }
        } catch (cacheError) {
          logger.warn('Cache retrieval failed', { error: cacheError.message });
        }
      }

      // Calculate from database
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const volumeStats = await Stream.aggregate([
        {
          $match: {
            createdAt: { $gte: oneDayAgo },
          },
        },
        {
          $group: {
            _id: null,
            totalVolume: { $sum: { $toDouble: '$totalAmount' } },
            streamCount: { $sum: 1 },
            avgStreamSize: { $avg: { $toDouble: '$totalAmount' } },
          },
        },
      ]);

      const volume = volumeStats[0] || { totalVolume: 0, streamCount: 0, avgStreamSize: 0 };

      const result = {
        timestamp: new Date().toISOString(),
        period: '24h',
        totalVolume: volume.totalVolume,
        totalVolumeFormatted: this._formatNumber(volume.totalVolume),
        streamCount: volume.streamCount,
        averageStreamSize: volume.avgStreamSize,
        averageStreamSizeFormatted: this._formatNumber(volume.avgStreamSize),
      };

      // Store in cache
      if (cache.isConnected) {
        try {
          await cache.set(cacheKey, JSON.stringify(result), { EX: CACHE_TTL });
        } catch (cacheError) {
          logger.warn('Cache set failed', { error: cacheError.message });
        }
      }

      return result;
    } catch (error) {
      logger.error('Error getting 24h volume', { error: error.message });
      throw error;
    }
  }

  /**
   * Format large numbers with abbreviations (K, M, B, etc.)
   * @private
   */
  _formatNumber(num) {
    if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + 'B';
    }
    if (num >= 1e6) {
      return (num / 1e6).toFixed(2) + 'M';
    }
    if (num >= 1e3) {
      return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
  }

  /**
   * Clear all cached analytics data
   * @returns {Promise<void>}
   */
  async clearCache() {
    try {
      const cache = getCacheService();
      if (cache.isConnected) {
        await Promise.all([
          cache.del(CACHE_KEY_TVL),
          cache.del(CACHE_KEY_STREAMS),
          cache.del(CACHE_KEY_TOKENS),
          cache.del(CACHE_KEY_VOLUME),
        ]);
        logger.info('Analytics cache cleared');
      }
    } catch (error) {
      logger.error('Error clearing cache', { error: error.message });
    }
  }
}

module.exports = TVLAnalyticsService;
