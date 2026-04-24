/**
 * @title Bridge Routes Tests
 * @description Test suite for bridge API endpoints
 */

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const bridgeRoutes = require("../../routes/bridge-routes");
const { errorHandler } = require("../../middleware/error-handler");
const { generateToken } = require("../../middleware/auth");
const User = require("../../models/User");
const {
  getBridgeRelayer,
  resetBridgeRelayer,
  SOURCE_CHAINS,
} = require("../../services/bridge-relayer");

let mongoServer;
let app;
let testUser;
let validToken;

const TEST_PUBLIC_KEY = "GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP";

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = "test-secret-key-for-testing";
  process.env.JWT_EXPIRES_IN = "1h";

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = "test-correlation-id";
    next();
  });

  app.use("/api", bridgeRoutes);
  app.use(errorHandler);

  testUser = await User.create({
    publicKey: TEST_PUBLIC_KEY,
    email: "test@example.com",
    role: "user",
  });

  validToken = generateToken(TEST_PUBLIC_KEY, "test@example.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(() => {
  resetBridgeRelayer();
});

describe("Bridge Routes - Status", () => {
  it("GET /api/bridge/relayer/status should return status", async () => {
    getBridgeRelayer({
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    const response = await request(app)
      .get("/api/bridge/relayer/status")
      .set("Authorization", `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.configured).toBe(true);
  });
});

describe("Bridge Routes - Relayer Control", () => {
  it("POST /api/bridge/relayer/start should start relayer", async () => {
    getBridgeRelayer({
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/start")
      .set("Authorization", `Bearer ${validToken}`);

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
  });

  it("POST /api/bridge/relayer/stop should stop relayer", async () => {
    getBridgeRelayer({
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/stop")
      .set("Authorization", `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

describe("Bridge Routes - Event Simulation", () => {
  it("POST /api/bridge/relayer/simulate should simulate event", async () => {
    getBridgeRelayer({
      enabled: true,
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
        relayEndpointUrl: "http://localhost:3001/relay",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/simulate")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        sourceChain: SOURCE_CHAINS.SOROBAN,
        event: {
          action: "lock",
          symbol: "XLM",
          amount: "1000",
          recipient: "0x1234567890abcdef1234567890abcdef12345678",
        },
        metadata: {},
      });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
  });

  it("should skip unrecognized actions", async () => {
    getBridgeRelayer({
      enabled: true,
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/simulate")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        sourceChain: SOURCE_CHAINS.SOROBAN,
        event: { action: "unknown", symbol: "XLM" },
        metadata: {},
      });

    expect(response.status).toBe(200);
    expect(response.body.data.command).toBeNull();
  });
});

describe("Bridge Routes - Event Ingestion", () => {
  it("POST /api/bridge/relayer/ingest should ingest event", async () => {
    getBridgeRelayer({
      enabled: true,
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
        relayEndpointUrl: "http://localhost:3001/relay",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/ingest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        sourceChain: SOURCE_CHAINS.SOROBAN,
        event: {
          action: "lock",
          symbol: "XLM",
          amount: "1000",
          recipient: "0x1234567890abcdef1234567890abcdef12345678",
        },
        metadata: {},
      });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
  });

  it("should handle disabled relayer", async () => {
    getBridgeRelayer({ enabled: false, config: { enabled: false } });

    const response = await request(app)
      .post("/api/bridge/relayer/ingest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({
        sourceChain: SOURCE_CHAINS.SOROBAN,
        event: { action: "lock", symbol: "XLM" },
        metadata: {},
      });

    expect(response.status).toBe(202);
    expect(response.body.data.reason).toBe("Relayer disabled");
  });
});

describe("Bridge Routes - Admin Operations", () => {
  it("POST /api/bridge/relayer/reset should require admin role", async () => {
    testUser.role = "user";

    const response = await request(app)
      .post("/api/bridge/relayer/reset")
      .set("Authorization", `Bearer ${validToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/admin/i);
  });

  it("POST /api/bridge/relayer/reset should work for admin", async () => {
    testUser.role = "admin";
    testUser.isAdmin = true;

    getBridgeRelayer({
      enabled: true,
      config: {
        enabled: true,
        direction: "both",
        sorobanAccountId: "GDZST3XVCDTUJ76ZAV2HA72KYKYAA4B4WYE4V5F3MFGAFJHR355XYEPJ",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
        evmRpcUrl: "https://eth-testnet.infura.io",
        evmBridgeAddress: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    const response = await request(app)
      .post("/api/bridge/relayer/reset")
      .set("Authorization", `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    testUser.role = "user";
    testUser.isAdmin = false;
  });
});
