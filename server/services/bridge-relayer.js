/**
 * @title Bridge Relayer Service
 * @description Monitors Soroban and EVM events and relays normalized bridge commands
 * @notice High-complexity cross-chain relay service with event normalization and command queuing
 */

const { logger } = require("../utils/logger");
const { getEnv } = require("../config/env-config");
const { SOURCE_CHAINS } = require("../validators/bridge-validator");

/**
 * Event action classification
 */
const ACTION_FAMILIES = Object.freeze({
  LOCK: ["lock", "deposit", "bridge.lock", "bridge.deposit", "bridge_locked"],
  RELEASE: [
    "release",
    "withdraw",
    "bridge.release",
    "bridge.withdraw",
    "bridge_released",
  ],
  MINT: ["mint", "bridge.mint", "bridge_mint"],
  BURN: ["burn", "bridge.burn", "bridge_burn"],
  TRANSFER: ["transfer", "bridge.transfer"],
});

const RELAY_ACTION_BY_FAMILY = Object.freeze({
  LOCK: "mint",
  RELEASE: "release",
  MINT: "mint",
  BURN: "release",
  TRANSFER: "transfer",
});

/**
 * Utility to convert number to hex
 */
const hexFromNumber = (value) => `0x${Number(value).toString(16)}`;

/**
 * Safely normalize text values from event data
 */
const normalizeText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value).toLowerCase();
  }

  if (typeof value === "object") {
    if (typeof value.value === "string") {
      return value.value.trim().toLowerCase();
    }
    if (typeof value.toString === "function") {
      return value.toString().toLowerCase();
    }
  }

  return String(value).toLowerCase();
};

/**
 * Pick first non-empty value from arguments
 */
const pickFirst = (...candidates) => {
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (normalized && normalized.length > 0) {
      return normalized;
    }
  }
  return "";
};

/**
 * Classify event action into family
 */
const getActionFamily = (action) => {
  const normalized = normalizeText(action);

  for (const [family, actions] of Object.entries(ACTION_FAMILIES)) {
    if (actions.some((a) => normalizeText(a) === normalized)) {
      return family;
    }
  }

  return null;
};

/**
 * Create stable bridge ID from event data
 */
const createBridgeId = (source, event, family, symbol, amount, recipient) => {
  const parts = [
    source,
    family || "unknown",
    symbol || "unknown-token",
    amount || "0",
    recipient || "unknown-addr",
    event.id || event.eventId || Date.now(),
  ];

  const combined = parts.join("|");
  return Buffer.from(combined).toString("base64").substring(0, 64);
};

/**
 * Get relay action type for event family
 */
const getRelayAction = (family) => {
  return RELAY_ACTION_BY_FAMILY[family] || "transfer";
};

/**
 * Build relay command from event data
 */
const buildRelayCommand = (sourceChain, event, context = {}) => {
  const source = normalizeText(sourceChain);
  
  if (!source || !event) {
    return null;
  }

  // Determine target chain
  const targetChain =
    source === SOURCE_CHAINS.SOROBAN ? SOURCE_CHAINS.EVM : SOURCE_CHAINS.SOROBAN;

  // Extract action
  const sourceAction = pickFirst(
    event.action,
    event.type,
    typeof event.event === "string" ? event.event : null,
  );

  if (!sourceAction) {
    return null;
  }

  // Classify action
  const family = getActionFamily(sourceAction);

  if (!family) {
    return null;
  }

  const targetAction = getRelayAction(family);

  // Extract asset information
  const assetSymbol = pickFirst(
    event.symbol,
    event.assetSymbol,
    event.token,
    event.details?.symbol,
    event.args?.symbol,
  );

  const contractId = pickFirst(
    event.contractId,
    event.details?.contractId,
    event.args?.contractId,
  );

  // Extract amount
  const amount = pickFirst(
    event.amount,
    event.value,
    event.details?.amount,
    event.details?.value,
    event.args?.amount,
    event.args?.value,
  );

  // Extract recipient/destination
  const recipient = pickFirst(
    event.recipient,
    event.destination,
    event.details?.recipient,
    event.details?.destination,
    event.args?.recipient,
    event.args?.destination,
    event.args?.to,
  );

  // Extract sender
  const sender = pickFirst(
    event.sender,
    event.from,
    event.data?.sender,
    event.details?.sender,
    event.args?.sender,
    event.args?.from,
  );

  // Validate that at least one of recipient/amount is present
  if (!recipient && !amount) {
    return null;
  }

  const sourceTxHash = pickFirst(
    event.transactionHash,
    event.txHash,
    event.hash,
    event.transaction_hash,
    event.id,
  );

  return {
    bridgeId: createBridgeId(source, event, family, assetSymbol, amount, recipient),
    sourceChain: source,
    targetChain,
    sourceAction,
    targetAction,
    asset: {
      symbol: assetSymbol,
      contractId,
    },
    amount,
    recipient,
    sender,
    sourceTxHash,
    metadata: {
      ...context.metadata,
      sourceEventId: pickFirst(
        event.id,
        event.eventId,
        event.sequence,
        event.paging_token,
      ),
      sourceChainName: source,
      targetChainName: targetChain,
      actionFamily: family,
      actor: context.actor,
      timestamp: new Date().toISOString(),
    },
    originalEvent: event,
  };
};

/**
 * Load default configuration from environment
 */
const defaultConfig = () => {
  const env = getEnv();

  return {
    enabled: Boolean(env.BRIDGE_RELAYER_ENABLED),
    direction: env.BRIDGE_RELAYER_DIRECTION || "both",
    sorobanAccountId:
      env.BRIDGE_SOROBAN_ACCOUNT_ID || env.BRIDGE_SOROBAN_ACCOUNT || "",
    sorobanRpcUrl:
      env.BRIDGE_SOROBAN_RPC_URL || env.SOROBAN_RPC_URLS || env.SOROBAN_RPC_URL || "",
    evmRpcUrl: env.BRIDGE_EVM_RPC_URL || "",
    evmBridgeAddress: env.BRIDGE_EVM_BRIDGE_ADDRESS || "",
    evmStartBlock:
      env.BRIDGE_EVM_START_BLOCK === null ||
      env.BRIDGE_EVM_START_BLOCK === undefined
        ? null
        : Number(env.BRIDGE_EVM_START_BLOCK),
    pollIntervalMs: env.BRIDGE_POLL_INTERVAL_MS || 15000,
    relayEndpointUrl: env.BRIDGE_RELAY_ENDPOINT_URL || "",
    evmRelayUrl: env.BRIDGE_EVM_RELAY_URL || "",
    sorobanRelayUrl: env.BRIDGE_SOROBAN_RELAY_URL || "",
  };
};

/**
 * Main Bridge Relayer Class
 */
class BridgeRelayer {
  constructor(options = {}) {
    this.config = {
      ...defaultConfig(),
      ...options.config,
    };

    this.enabled = options.enabled ?? this.config.enabled;
    this.relayExecutor =
      options.relayExecutor || ((command) => this._relayCommand(command));

    this.queue = [];
    this.processing = null;
    this.sorobanStream = null;
    this.evmPollTimer = null;

    this.stats = {
      observed: 0,
      skipped: 0,
      relayed: 0,
      failed: 0,
      lastObservedAt: null,
      lastRelayedAt: null,
      lastError: null,
    };

    this.logger = logger.child({ component: "BridgeRelayer" });
  }

  /**
   * Check if relayer is properly configured
   */
  isConfigured() {
    const sorobanConfigured = Boolean(this.config.sorobanAccountId && this.config.sorobanRpcUrl);
    const evmConfigured = Boolean(this.config.evmBridgeAddress && this.config.evmRpcUrl);

    if (this.config.direction === "both") {
      return sorobanConfigured && evmConfigured;
    }

    if (this.config.direction === "soroban-to-evm") {
      return sorobanConfigured && evmConfigured;
    }

    if (this.config.direction === "evm-to-soroban") {
      return sorobanConfigured && evmConfigured;
    }

    return false;
  }

  /**
   * Start monitoring bridge events
   */
  async start() {
    if (!this.isConfigured()) {
      throw new Error("Bridge relayer is not properly configured");
    }

    const shouldMonitorSoroban =
      this.config.direction === "both" || this.config.direction === "evm-to-soroban";
    const shouldMonitorEvm =
      this.config.direction === "both" || this.config.direction === "soroban-to-evm";

    if (shouldMonitorSoroban && this.config.sorobanAccountId) {
      try {
        await this._startSorobanMonitor();
      } catch (error) {
        this.logger.warn("Failed to start Soroban monitor", {
          error: error.message,
        });
      }
    }

    if (shouldMonitorEvm && this.config.evmBridgeAddress) {
      try {
        await this._pollEvmOnce();
        this.evmPollTimer = setInterval(() => {
          void this._pollEvmOnce();
        }, this.config.pollIntervalMs);

        this.logger.info("Bridge relayer EVM poller started", {
          bridgeAddress: this.config.evmBridgeAddress,
          pollIntervalMs: this.config.pollIntervalMs,
        });
      } catch (error) {
        this.logger.warn("Failed to start EVM poller", {
          error: error.message,
        });
      }
    }

    this.logger.info("Bridge relayer started", {
      enabled: this.enabled,
      direction: this.config.direction,
    });

    return this.getStatus();
  }

  /**
   * Stop all monitoring
   */
  async stop() {
    if (this.sorobanStream) {
      this.sorobanStream.stop();
      this.sorobanStream = null;
    }

    if (this.evmPollTimer) {
      clearInterval(this.evmPollTimer);
      this.evmPollTimer = null;
    }

    await this.flushQueue();

    this.logger.info("Bridge relayer stopped");

    return this.getStatus();
  }

  /**
   * Start Soroban event monitoring (placeholder)
   * In production, this would connect to Soroban RPC streaming events
   */
  async _startSorobanMonitor() {
    // This would typically use Soroban's event streaming capability
    // For now, this is a placeholder that demonstrates the structure
    this.logger.info("Soroban event monitor initialized", {
      accountId: this.config.sorobanAccountId,
      rpcUrl: this.config.sorobanRpcUrl,
    });
  }

  /**
   * Poll EVM chain for bridge-related events
   */
  async _pollEvmOnce() {
    try {
      if (!this.config.evmRpcUrl || !this.config.evmBridgeAddress) {
        return;
      }

      // Get contract logs using eth_getLogs
      const logs = await this._evmRpcCall("eth_getLogs", [
        {
          address: this.config.evmBridgeAddress,
          fromBlock: hexFromNumber(
            this.config.evmStartBlock || 0,
          ),
          toBlock: "latest",
        },
      ]);

      if (!Array.isArray(logs)) {
        return;
      }

      for (const log of logs) {
        await this.ingestEvent(SOURCE_CHAINS.EVM, log, { metadata: {} });
      }
    } catch (error) {
      this.logger.error("EVM polling failed", {
        error: error.message,
      });
    }
  }

  /**
   * Make EVM JSON-RPC call
   */
  async _evmRpcCall(method, params) {
    const response = await fetch(this.config.evmRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`EVM RPC request failed with HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload.error) {
      throw new Error(
        payload.error.message || "Unknown EVM RPC error",
      );
    }

    return payload.result;
  }

  /**
   * Ingest an event from either chain
   */
  async ingestEvent(sourceChain, event, context = {}) {
    if (!this.enabled) {
      return null;
    }

    this.stats.observed += 1;
    this.stats.lastObservedAt = new Date().toISOString();

    const command = buildRelayCommand(sourceChain, event, context);

    if (!command) {
      this.stats.skipped += 1;
      return null;
    }

    this.queue.push(command);
    await this.flushQueue();

    return command;
  }

  /**
   * Process queued relay commands
   */
  async flushQueue() {
    if (this.processing) {
      return this.processing;
    }

    this.processing = (async () => {
      while (this.queue.length > 0) {
        const command = this.queue.shift();

        try {
          const relayResult = await this.relayExecutor(command);

          if (relayResult?.dispatched) {
            this.stats.relayed += 1;
            this.stats.lastRelayedAt = new Date().toISOString();
            this.logger.info("Bridge command relayed", {
              bridgeId: command.bridgeId,
              sourceChain: command.sourceChain,
              targetChain: command.targetChain,
              targetAction: command.targetAction,
              relayResult,
            });
          }
        } catch (error) {
          this.stats.failed += 1;
          this.stats.lastError = error.message;
          this.logger.error("Bridge command relay failed", {
            bridgeId: command.bridgeId,
            error: error.message,
            targetChain: command.targetChain,
          });
        }
      }
    })();

    try {
      return await this.processing;
    } finally {
      this.processing = null;
    }
  }

  /**
   * Get current relayer status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      direction: this.config.direction,
      queue: {
        pending: this.queue.length,
        processing: this.processing ? 1 : 0,
      },
      stats: {
        ...this.stats,
      },
      config: {
        sorobanAccountId: this.config.sorobanAccountId
          ? this.config.sorobanAccountId.substring(0, 6) + "..."
          : "not set",
        evmBridgeAddress: this.config.evmBridgeAddress
          ? this.config.evmBridgeAddress.substring(0, 6) + "..."
          : "not set",
      },
    };
  }

  /**
   * Relay command to execution endpoint
   */
  async _relayCommand(command) {
    const targetUrl =
      command.targetChain === SOURCE_CHAINS.EVM
        ? this.config.evmRelayUrl || this.config.relayEndpointUrl
        : this.config.sorobanRelayUrl || this.config.relayEndpointUrl;

    if (!targetUrl) {
      return {
        dispatched: false,
        reason: "No relay endpoint configured",
        targetChain: command.targetChain,
      };
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SoroMint-Bridge-Id": command.bridgeId,
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(
        `Bridge relay endpoint responded with HTTP ${response.status}`,
      );
    }

    return {
      dispatched: true,
      targetUrl,
      status: response.status,
    };
  }
}

let bridgeRelayer = null;

const createBridgeRelayer = (options = {}) => new BridgeRelayer(options);

const getBridgeRelayer = (options = {}) => {
  if (options.instance) {
    bridgeRelayer = options.instance;
    return bridgeRelayer;
  }

  if (!bridgeRelayer || options.reset) {
    bridgeRelayer = new BridgeRelayer(options);
  }

  return bridgeRelayer;
};

const resetBridgeRelayer = () => {
  bridgeRelayer = null;
};

module.exports = {
  BridgeRelayer,
  SOURCE_CHAINS,
  buildRelayCommand,
  createBridgeRelayer,
  getBridgeRelayer,
  resetBridgeRelayer,
};
