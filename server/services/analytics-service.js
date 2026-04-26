/**
 * @title Blockchain Analytics Service
 * @description Exports SoroMint token and activity data to external blockchain
 *   analytics platforms (Dune Analytics, Bubble, or any webhook-compatible tool).
 *   All exports are privacy-compliant — no PII is shared, only on-chain identifiers.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");
const Token = require("../models/Token");
const DeploymentAudit = require("../models/DeploymentAudit");
const SorobanEvent = require("../models/SorobanEvent");
const { logger } = require("../utils/logger");

/**
 * Build a privacy-safe token payload — strips internal MongoDB IDs,
 * retains only on-chain / non-PII fields.
 * @param {Object} token - Mongoose Token document
 * @returns {Object}
 */
function sanitizeToken(token) {
  return {
    contractId: token.contractId,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    createdAt: token.createdAt,
  };
}

/**
 * Build a privacy-safe audit payload.
 * @param {Object} audit - Mongoose DeploymentAudit document
 * @returns {Object}
 */
function sanitizeAudit(audit) {
  return {
    contractId: audit.contractId,
    tokenName: audit.tokenName,
    status: audit.status,
    createdAt: audit.createdAt,
  };
}

/**
 * Collect and sanitize the current analytics snapshot from MongoDB.
 * @returns {Promise<Object>} privacy-safe analytics payload
 */
async function buildAnalyticsPayload() {
  const [tokens, audits] = await Promise.all([
    Token.find({}).select("contractId name symbol decimals createdAt").lean(),
    DeploymentAudit.find({}).select("contractId tokenName status createdAt").lean(),
  ]);

  const totalTokens = tokens.length;
  const successfulDeploys = audits.filter((a) => a.status === "SUCCESS").length;
  const failedDeploys = audits.filter((a) => a.status === "FAIL").length;

  return {
    exportedAt: new Date().toISOString(),
    summary: { totalTokens, successfulDeploys, failedDeploys },
    tokens: tokens.map(sanitizeToken),
    deploymentActivity: audits.map(sanitizeAudit),
  };
}

/**
 * POST a JSON payload to an arbitrary HTTPS webhook URL.
 * @param {string} webhookUrl
 * @param {Object} payload
 * @param {string} [apiKey] - Optional Bearer token / API key
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function postWebhook(webhookUrl, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(webhookUrl);
    const body = JSON.stringify(payload);

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("Analytics webhook request timed out"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Sync analytics data to all configured external platforms.
 * Platforms are configured via environment variables:
 *   ANALYTICS_WEBHOOK_URL   — generic webhook (Bubble, custom dashboards)
 *   ANALYTICS_WEBHOOK_KEY   — optional Bearer key for the above
 *   DUNE_API_KEY            — Dune Analytics API key
 *   DUNE_NAMESPACE          — Dune namespace (username)
 *   DUNE_TABLE_NAME         — Dune table to upsert into
 *
 * @returns {Promise<Object>} sync result summary
 */
async function syncAnalytics() {
  const payload = await buildAnalyticsPayload();
  const results = [];

  // --- Generic webhook (Bubble, custom dashboards) ---
  const webhookUrl = process.env.ANALYTICS_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const res = await postWebhook(
        webhookUrl,
        payload,
        process.env.ANALYTICS_WEBHOOK_KEY
      );
      logger.info("Analytics synced to webhook", {
        url: webhookUrl,
        statusCode: res.statusCode,
      });
      results.push({ platform: "webhook", statusCode: res.statusCode, ok: res.statusCode < 400 });
    } catch (err) {
      logger.error("Analytics webhook sync failed", { error: err.message });
      results.push({ platform: "webhook", ok: false, error: err.message });
    }
  }

  // --- Dune Analytics (CSV upload via REST API) ---
  const duneKey = process.env.DUNE_API_KEY;
  const duneNamespace = process.env.DUNE_NAMESPACE;
  const duneTable = process.env.DUNE_TABLE_NAME;

  if (duneKey && duneNamespace && duneTable) {
    try {
      const dunePayload = {
        data: payload.tokens.map((t) => ({
          contract_id: t.contractId,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
          created_at: t.createdAt,
        })),
      };

      const duneUrl = `https://api.dune.com/api/v1/table/${duneNamespace}/${duneTable}/insert`;
      const res = await postWebhook(duneUrl, dunePayload, duneKey);
      logger.info("Analytics synced to Dune", {
        namespace: duneNamespace,
        table: duneTable,
        statusCode: res.statusCode,
      });
      results.push({ platform: "dune", statusCode: res.statusCode, ok: res.statusCode < 400 });
    } catch (err) {
      logger.error("Dune Analytics sync failed", { error: err.message });
      results.push({ platform: "dune", ok: false, error: err.message });
    }
  }

  if (results.length === 0) {
    logger.warn("No analytics platforms configured — set ANALYTICS_WEBHOOK_URL or DUNE_API_KEY");
  }

  return { exportedAt: payload.exportedAt, summary: payload.summary, results };
}

/**
 * Aggregate transfer data for all tokens minted via the platform.
 * Queries SorobanEvent records with eventType containing 'transfer' patterns.
 * @returns {Promise<Object>} transfer aggregation data
 */
async function getTransferAggregation() {
  try {
    // Get all tokens in the system
    const tokens = await Token.find({}).select("contractId name symbol decimals").lean();
    
    const transferData = [];
    let totalTransfers = 0;
    let totalUniqueTransferers = new Set();

    for (const token of tokens) {
      // Find all transfer events for this token
      const transfers = await SorobanEvent.find({
        contractId: token.contractId,
        eventType: { $regex: "transfer", $options: "i" },
      }).lean();

      const transferCount = transfers.length;
      totalTransfers += transferCount;

      // Extract unique senders from topics/value
      const uniqueSenders = new Set();
      transfers.forEach((event) => {
        if (event.topics && event.topics.length > 0) {
          uniqueSenders.add(event.topics[0]);
          totalUniqueTransferers.add(event.topics[0]);
        }
      });

      // Calculate total volume from all transfers
      let totalVolume = 0n;
      transfers.forEach((event) => {
        if (event.value && typeof event.value === "object" && event.value.amount) {
          try {
            totalVolume += BigInt(event.value.amount || 0);
          } catch (e) {
            // Skip invalid parsing
          }
        }
      });

      transferData.push({
        contractId: token.contractId,
        tokenName: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        transferCount,
        uniqueTransferers: uniqueSenders.size,
        totalVolume: totalVolume.toString(),
        lastTransferAt: transfers.length > 0 
          ? new Date(Math.max(...transfers.map(t => new Date(t.ledgerClosedAt).getTime())))
          : null,
      });
    }

    return {
      exportedAt: new Date().toISOString(),
      summary: {
        totalTransfers,
        totalUniqueTransferers: totalUniqueTransferers.size,
        tokensWithTransfers: transferData.filter(t => t.transferCount > 0).length,
      },
      transfers: transferData,
    };
  } catch (error) {
    logger.error("Error getting transfer aggregation", { error: error.message });
    throw error;
  }
}

/**
 * Get holder distribution across all tokens.
 * Aggregates unique holders per token based on transfer events.
 * @returns {Promise<Object>} holder distribution data
 */
async function getHolderDistribution() {
  try {
    const tokens = await Token.find({}).select("contractId name symbol decimals").lean();
    
    const holderData = [];
    let totalHolders = new Set();

    for (const token of tokens) {
      // Find all transfer events involving this token
      const transfers = await SorobanEvent.find({
        contractId: token.contractId,
        eventType: { $regex: "transfer", $options: "i" },
      }).lean();

      // Extract unique recipients (typically second topic) and senders (first topic)
      const uniqueHolders = new Set();
      transfers.forEach((event) => {
        if (event.topics && event.topics.length > 0) {
          uniqueHolders.add(event.topics[0]); // sender
          if (event.topics.length > 1) {
            uniqueHolders.add(event.topics[1]); // recipient
          }
        }
      });

      uniqueHolders.forEach(holder => totalHolders.add(holder));

      holderData.push({
        contractId: token.contractId,
        tokenName: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        uniqueHolders: uniqueHolders.size,
        topHolderCount: Math.min(10, uniqueHolders.size), // Can be extended to track top holders
      });
    }

    return {
      exportedAt: new Date().toISOString(),
      summary: {
        totalUniquePlatformHolders: totalHolders.size,
        tokensWithHolders: holderData.filter(h => h.uniqueHolders > 0).length,
        averageHoldersPerToken: holderData.length > 0 
          ? Math.round(holderData.reduce((sum, h) => sum + h.uniqueHolders, 0) / holderData.length)
          : 0,
      },
      holders: holderData,
    };
  } catch (error) {
    logger.error("Error getting holder distribution", { error: error.message });
    throw error;
  }
}

/**
 * Get volume metrics for all tokens.
 * Aggregates transfer volume and trends over time.
 * @param {number} [days=30] - Number of days to analyze
 * @returns {Promise<Object>} volume metrics data
 */
async function getVolumeMetrics(days = 30) {
  try {
    const tokens = await Token.find({}).select("contractId name symbol decimals").lean();
    
    const volumeData = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let totalPlatformVolume = 0n;

    for (const token of tokens) {
      // Get recent transfer events
      const recentTransfers = await SorobanEvent.find({
        contractId: token.contractId,
        eventType: { $regex: "transfer", $options: "i" },
        ledgerClosedAt: { $gte: cutoffDate },
      }).sort({ ledgerClosedAt: -1 }).lean();

      // Calculate volume metrics
      let volume24h = 0n;
      let volume7d = 0n;
      let volume30d = 0n;

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      recentTransfers.forEach((event) => {
        let eventAmount = 0n;
        try {
          eventAmount = BigInt(event.value?.amount || 0);
        } catch (e) {
          // Skip invalid amounts
        }

        const eventDate = new Date(event.ledgerClosedAt);
        
        if (eventDate >= oneDayAgo) volume24h += eventAmount;
        if (eventDate >= sevenDaysAgo) volume7d += eventAmount;
        volume30d += eventAmount;
      });

      totalPlatformVolume += volume30d;

      // Calculate daily average
      const dailyAverage = days > 0 
        ? (BigInt(Math.floor(Number(volume30d) / days))).toString()
        : "0";

      volumeData.push({
        contractId: token.contractId,
        tokenName: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        volume24h: volume24h.toString(),
        volume7d: volume7d.toString(),
        volume30d: volume30d.toString(),
        dailyAverage,
        transferCount30d: recentTransfers.length,
        avgTransferSize: recentTransfers.length > 0
          ? (BigInt(Math.floor(Number(volume30d) / recentTransfers.length))).toString()
          : "0",
      });
    }

    return {
      exportedAt: new Date().toISOString(),
      period: { days, startDate: cutoffDate.toISOString() },
      summary: {
        totalPlatformVolume30d: totalPlatformVolume.toString(),
        volumeMetricsTokens: volumeData.filter(v => BigInt(v.volume30d) > 0n).length,
      },
      volumes: volumeData,
    };
  } catch (error) {
    logger.error("Error getting volume metrics", { error: error.message });
    throw error;
  }
}

/**
 * Get comprehensive metrics for all tokens combining transfers, holders, and volume.
 * @param {number} [days=30] - Number of days for volume analysis
 * @returns {Promise<Object>} comprehensive token metrics
 */
async function getTokensMetrics(days = 30) {
  try {
    const [transfers, holders, volumes] = await Promise.all([
      getTransferAggregation(),
      getHolderDistribution(),
      getVolumeMetrics(days),
    ]);

    // Merge all metrics by contractId
    const metricsMap = new Map();

    // Add transfer data
    transfers.transfers.forEach((t) => {
      metricsMap.set(t.contractId, {
        contractId: t.contractId,
        tokenName: t.tokenName,
        symbol: t.symbol,
        decimals: t.decimals,
        ...t,
      });
    });

    // Merge holder data
    holders.holders.forEach((h) => {
      const existing = metricsMap.get(h.contractId) || {};
      metricsMap.set(h.contractId, {
        ...existing,
        ...h,
      });
    });

    // Merge volume data
    volumes.volumes.forEach((v) => {
      const existing = metricsMap.get(v.contractId) || {};
      metricsMap.set(v.contractId, {
        ...existing,
        ...v,
      });
    });

    const metrics = Array.from(metricsMap.values());

    return {
      exportedAt: new Date().toISOString(),
      volumePeriod: { days, startDate: volumes.period.startDate },
      platformSummary: {
        totalTokens: metrics.length,
        totalTransfers: transfers.summary.totalTransfers,
        totalUniqueTransferers: transfers.summary.totalUniqueTransferers,
        totalUniquePlatformHolders: holders.summary.totalUniquePlatformHolders,
        totalPlatformVolume30d: volumes.summary.totalPlatformVolume30d,
        tokensWithActivity: metrics.filter(m => (m.transferCount || 0) > 0).length,
      },
      tokens: metrics,
    };
  } catch (error) {
    logger.error("Error getting comprehensive tokens metrics", { error: error.message });
    throw error;
  }
}

module.exports = { 
  syncAnalytics, 
  buildAnalyticsPayload,
  getTransferAggregation,
  getHolderDistribution,
  getVolumeMetrics,
  getTokensMetrics,
};
