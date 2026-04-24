/**
 * @title Bridge Relayer Service Tests
 * @description Test suite for bridge relayer event normalization and command building
 */

const {
  BridgeRelayer,
  buildRelayCommand,
  SOURCE_CHAINS,
  createBridgeRelayer,
  getBridgeRelayer,
  resetBridgeRelayer,
} = require("../../services/bridge-relayer");

describe("buildRelayCommand", () => {
  it("should build command from Soroban lock event", () => {
    const event = {
      action: "lock",
      symbol: "XLM",
      amount: "1000",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
      sender: "GBUQWP3BOUZX34LOCALEO5ZPAQ24NH5V5RMHVVNVLCVT2CPFMQKTCZZ7",
      id: "soroban-event-1",
    };

    const command = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event, {});

    expect(command).not.toBeNull();
    expect(command.sourceChain).toBe(SOURCE_CHAINS.SOROBAN);
    expect(command.targetChain).toBe(SOURCE_CHAINS.EVM);
    expect(command.targetAction).toBe("mint");
    expect(command.asset.symbol).toBe("xlm");
    expect(command.amount).toBe("1000");
    expect(command.bridgeId).toBeDefined();
    expect(command.metadata.timestamp).toBeDefined();
  });

  it("should build command from EVM deposit event", () => {
    const event = {
      action: "deposit",
      symbol: "ETH",
      amount: "5000000000000000000",
      to: "GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP",
      from: "0x1234567890abcdef1234567890abcdef12345678",
      transactionHash:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    };

    const command = buildRelayCommand(SOURCE_CHAINS.EVM, event, {});

    expect(command).not.toBeNull();
    expect(command.sourceChain).toBe(SOURCE_CHAINS.EVM);
    expect(command.targetChain).toBe(SOURCE_CHAINS.SOROBAN);
    expect(command.targetAction).toBe("mint");
    expect(command.asset.symbol).toBe("eth");
  });

  it("should skip events without recognized action", () => {
    const event = {
      action: "unknown-action",
      symbol: "XLM",
      amount: "1000",
    };

    const command = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event, {});

    expect(command).toBeNull();
  });

  it("should skip events without required fields", () => {
    const event = {
      action: "transfer",
      // missing symbol, amount, recipient
    };

    const command = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event, {});

    expect(command).toBeNull();
  });

  it("should normalize action names", () => {
    const event1 = {
      action: "LOCK",
      symbol: "XLM",
      amount: "1000",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    };

    const event2 = {
      action: "bridge.lock",
      symbol: "XLM",
      amount: "1000",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    };

    const command1 = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event1, {});
    const command2 = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event2, {});

    // Both should build commands
    expect(command1).not.toBeNull();
    expect(command2).not.toBeNull();
    // Both should have the same target action despite different source actions
    expect(command1.targetAction).toBe(command2.targetAction);
    expect(command1.targetAction).toBe("mint");
  });

  it("should pick first available value from multiple candidates", () => {
    const event = {
      action: "transfer",
      symbol: undefined,
      assetSymbol: null,
      token: "ETH",
      amount: "1000",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    };

    const command = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event, {});

    expect(command).not.toBeNull();
    expect(command.asset.symbol).toBe("eth");
  });

  it("should include actor in metadata", () => {
    const event = {
      action: "lock",
      symbol: "XLM",
      amount: "1000",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    };

    const context = {
      actor: "user@example.com",
      metadata: { custom: "value" },
    };

    const command = buildRelayCommand(SOURCE_CHAINS.SOROBAN, event, context);

    expect(command.metadata.actor).toBe("user@example.com");
    expect(command.metadata.custom).toBe("value");
  });
});

describe("BridgeRelayer", () => {
  let relayer;

  beforeEach(() => {
    resetBridgeRelayer();
    relayer = new BridgeRelayer({
      enabled: true,
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
        evmStartBlock: 0,
        pollIntervalMs: 15000,
        relayEndpointUrl: "http://localhost:3001/relay",
      },
    });
  });

  afterEach(async () => {
    await relayer.stop();
  });

  describe("isConfigured", () => {
    it("should return true when all required config is present", () => {
      expect(relayer.isConfigured()).toBe(true);
    });

    it("should return false when soroban config is missing", () => {
      relayer.config.sorobanAccountId = "";
      expect(relayer.isConfigured()).toBe(false);
    });

    it("should return false when evm config is missing", () => {
      relayer.config.evmBridgeAddress = "";
      expect(relayer.isConfigured()).toBe(false);
    });

    it("should validate direction-specific configuration", () => {
      relayer.config.direction = "soroban-to-evm";
      expect(relayer.isConfigured()).toBe(true);

      relayer.config.direction = "evm-to-soroban";
      expect(relayer.isConfigured()).toBe(true);
    });
  });

  describe("ingestEvent", () => {
    it("should queue valid events", async () => {
      const event = {
        action: "lock",
        symbol: "XLM",
        amount: "1000",
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
      };

      const command = await relayer.ingestEvent(SOURCE_CHAINS.SOROBAN, event, {});

      expect(command).not.toBeNull();
      expect(relayer.stats.observed).toBe(1);
    });

    it("should skip invalid events", async () => {
      const event = {
        action: "unknown",
        symbol: "XLM",
      };

      const command = await relayer.ingestEvent(SOURCE_CHAINS.SOROBAN, event, {});

      expect(command).toBeNull();
      expect(relayer.stats.observed).toBe(1);
      expect(relayer.stats.skipped).toBe(1);
    });

    it("should not ingest when relayer is disabled", async () => {
      relayer.enabled = false;

      const event = {
        action: "lock",
        symbol: "XLM",
        amount: "1000",
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
      };

      const command = await relayer.ingestEvent(SOURCE_CHAINS.SOROBAN, event, {});

      expect(command).toBeNull();
      expect(relayer.stats.observed).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("should return current relayer status", () => {
      const status = relayer.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.direction).toBe("both");
      expect(status.queue).toBeDefined();
      expect(status.stats).toBeDefined();
      expect(status.config).toBeDefined();
    });

    it("should include queue metrics", () => {
      relayer.queue.push({ bridgeId: "test-1" });

      const status = relayer.getStatus();

      expect(status.queue.pending).toBe(1);
    });

    it("should mask sensitive config values", () => {
      const status = relayer.getStatus();

      expect(status.config.sorobanAccountId).not.toContain("GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ");
      expect(status.config.sorobanAccountId).toMatch(/\.\.\.$/);
    });
  });

  describe("flushQueue", () => {
    it("should process queued commands", async () => {
      relayer.relayExecutor = jest.fn().mockResolvedValue({
        dispatched: true,
      });

      relayer.queue.push({
        bridgeId: "test-1",
        targetChain: SOURCE_CHAINS.EVM,
      });

      await relayer.flushQueue();

      expect(relayer.relayExecutor).toHaveBeenCalled();
      expect(relayer.queue.length).toBe(0);
      expect(relayer.stats.relayed).toBe(1);
    });

    it("should handle relay failures", async () => {
      relayer.relayExecutor = jest
        .fn()
        .mockRejectedValue(new Error("Relay failed"));

      relayer.queue.push({
        bridgeId: "test-1",
        targetChain: SOURCE_CHAINS.EVM,
      });

      await relayer.flushQueue();

      expect(relayer.stats.failed).toBe(1);
      expect(relayer.stats.lastError).toMatch(/Relay failed/);
    });
  });

  describe("singleton", () => {
    it("should maintain singleton instance", () => {
      resetBridgeRelayer();
      const relayer1 = getBridgeRelayer();
      const relayer2 = getBridgeRelayer();

      expect(relayer1).toBe(relayer2);
    });

    it("should allow setting custom instance", () => {
      const customRelayer = new BridgeRelayer({ enabled: false });
      getBridgeRelayer({ instance: customRelayer });

      expect(getBridgeRelayer()).toBe(customRelayer);
    });
  });
});
