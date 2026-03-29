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

module.exports = { syncAnalytics, buildAnalyticsPayload };
