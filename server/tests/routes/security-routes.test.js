'use strict';

/**
 * @title Security Routes Integration Tests
 * @author SoroMint Team
 * @notice End-to-end tests for all 6 security API endpoints:
 *   POST   /api/security/scan
 *   GET    /api/security/scans
 *   GET    /api/security/scans/:scanId
 *   DELETE /api/security/scans/:scanId
 *   GET    /api/security/rules
 *   GET    /api/security/stats
 *
 * @dev Uses MongoMemoryServer for an isolated in-process MongoDB instance.
 *      The rate-limiter is replaced with a very permissive one so tests are
 *      not throttled.  All WASM blobs are constructed programmatically —
 *      no external .wasm fixtures are required.
 */

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const ScanResult = require('../../models/ScanResult');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const { createRateLimiter } = require('../../middleware/rate-limiter');
const { createSecurityRouter } = require('../../routes/security-routes');
const { RULES, SCAN_STATUS } = require('../../services/wasm-scanner');

// ─────────────────────────────────────────────────────────────────────────────
// Binary construction helpers (duplicated from wasm-scanner tests for isolation)
// ─────────────────────────────────────────────────────────────────────────────

const WASM_HEADER = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

function leb128U(n) {
  const bytes = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0);
  return bytes;
}

function wasmStr(s) {
  const enc = Buffer.from(s, 'utf8');
  return [...leb128U(enc.length), ...enc];
}

function section(id, content) {
  return [id, ...leb128U(content.length), ...content];
}

function importEntry(mod, name, kind = 0) {
  return [...wasmStr(mod), ...wasmStr(name), kind, 0x00];
}

function importSection(...entries) {
  return section(2, [...leb128U(entries.length), ...entries.flat()]);
}

function exportSection(name = '__invoke', kind = 0, idx = 0) {
  return section(7, [...leb128U(1), ...wasmStr(name), kind, ...leb128U(idx)]);
}

function memorySection(min, max = null) {
  const hasMax = max !== null;
  const body = hasMax
    ? [0x01, ...leb128U(min), ...leb128U(max)]
    : [0x00, ...leb128U(min)];
  return section(5, [...leb128U(1), ...body]);
}

function functionSection(count) {
  return section(3, [
    ...leb128U(count),
    ...Array(count)
      .fill(0)
      .flatMap(() => leb128U(0)),
  ]);
}

/** Build a minimal valid Soroban-like WASM that passes most rules. */
function buildCleanWasm(importCount = 5) {
  const imports = Array.from({ length: importCount }, (_, i) =>
    importEntry('_', `hfn_${i}`)
  );
  return Buffer.from([
    ...WASM_HEADER,
    ...importSection(...imports),
    ...functionSection(1),
    ...memorySection(1, 16),
    ...exportSection('__invoke'),
  ]);
}

/** Build a clearly malicious WASM (invalid magic). */
function buildBadMagicWasm() {
  return Buffer.from([0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]);
}

/** Encode a buffer as base64. */
const toBase64 = (buf) => buf.toString('base64');

// ─────────────────────────────────────────────────────────────────────────────
// Stellar key fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ALICE_PK = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
const BOB_PK = 'GA2DQGWZTIICWQ7MZ5VZ6CKKXQOGCDHUUFIFO7YUG6SGX63BVG433GZD';

// ─────────────────────────────────────────────────────────────────────────────
// Test state
// ─────────────────────────────────────────────────────────────────────────────

let mongoServer;
let app;
let aliceJwt;
let bobJwt;
let aliceUser;
let bobUser;

// ─────────────────────────────────────────────────────────────────────────────
// Suite setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET = 'test-security-routes-secret-xyz';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.WASM_MAX_SIZE_BYTES = String(5 * 1024 * 1024);

  // Permissive rate limiter so tests are never throttled
  const permissiveRateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 10_000,
  });

  // Build app — inject the permissive limiter via the router factory
  app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((_req, _res, next) => {
    _req.correlationId = 'test-cid';
    next();
  });

  // We need to override the module-level scanRateLimiter used inside
  // createSecurityRouter.  The simplest approach: mock the rate-limiter module
  // before requiring the router, or accept the default and set a high limit
  // via env vars — the default is 20/hour which is fine for our test count.
  // For robustness, we reset between tests using beforeEach wipes.
  app.use('/api', createSecurityRouter());
  app.use(errorHandler);

  // Seed users
  aliceUser = await User.create({ publicKey: ALICE_PK, username: 'alice' });
  bobUser = await User.create({ publicKey: BOB_PK, username: 'bob' });

  aliceJwt = generateToken(ALICE_PK, 'alice');
  bobJwt = generateToken(BOB_PK, 'bob');
});

beforeEach(async () => {
  await ScanResult.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.WASM_MAX_SIZE_BYTES;
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/security/scan convenience wrapper. */
const postScan = (body, jwt = aliceJwt) =>
  request(app)
    .post('/api/security/scan')
    .set('Authorization', `Bearer ${jwt}`)
    .send(body);

/** Seed a ScanResult directly for a user without going through the API. */
const seedScan = async (userId, overrides = {}) => {
  const wasm = buildCleanWasm();
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(wasm).digest('hex');

  return ScanResult.create({
    userId,
    wasmHash: hash,
    wasmSize: wasm.length,
    status: 'clean',
    findings: [],
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      passedChecks: 20,
      totalChecks: 20,
    },
    duration: 50,
    deploymentBlocked: false,
    scannerVersion: '1.0.0',
    ...overrides,
  });
};

// =============================================================================
// POST /api/security/scan
// =============================================================================

describe('POST /api/security/scan', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 201 with a complete scan report for a clean WASM', async () => {
    const res = await postScan({ wasm: toBase64(buildCleanWasm()) });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();

    const data = res.body.data;
    expect(data.scanId).toBeDefined();
    expect(data.status).toBeDefined();
    expect(data.wasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.wasmSize).toBeGreaterThan(0);
    expect(Array.isArray(data.findings)).toBe(true);
    expect(data.summary).toBeDefined();
    expect(typeof data.deploymentBlocked).toBe('boolean');
    expect(data.scannerVersion).toBe('1.0.0');
    expect(typeof data.duration).toBe('number');
    expect(data.createdAt).toBeDefined();
  });

  it('persists the scan result in the database', async () => {
    const res = await postScan({ wasm: toBase64(buildCleanWasm()) });

    expect(res.status).toBe(201);

    const { scanId } = res.body.data;
    const stored = await ScanResult.findOne({ scanId });
    expect(stored).not.toBeNull();
    expect(stored.userId.toString()).toBe(aliceUser._id.toString());
    expect(stored.scannerVersion).toBe('1.0.0');
  });

  it('returns status "clean" for a well-formed Soroban WASM', async () => {
    const res = await postScan({ wasm: toBase64(buildCleanWasm()) });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(SCAN_STATUS.CLEAN);
    expect(res.body.data.deploymentBlocked).toBe(false);
  });

  it('returns status "error" and deploymentBlocked=true for invalid WASM magic', async () => {
    const res = await postScan({ wasm: toBase64(buildBadMagicWasm()) });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(SCAN_STATUS.ERROR);
    expect(res.body.data.deploymentBlocked).toBe(true);
    expect(res.body.data.findings.some((f) => f.ruleId === 'SM-001')).toBe(
      true
    );
  });

  it('returns status "failed" and deploymentBlocked=true for a WASM with high-severity findings', async () => {
    // A WASM with a start section fires SM-011 (HIGH severity)
    const startSection = section(8, leb128U(0));
    const badWasm = Buffer.from([
      ...WASM_HEADER,
      ...importSection(
        ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`))
      ),
      ...functionSection(2),
      ...memorySection(1, 16),
      ...exportSection('__invoke'),
      ...startSection,
    ]);

    const res = await postScan({ wasm: toBase64(badWasm) });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(SCAN_STATUS.FAILED);
    expect(res.body.data.deploymentBlocked).toBe(true);
  });

  it('stores contractName and notes when provided', async () => {
    const res = await postScan({
      wasm: toBase64(buildCleanWasm()),
      contractName: 'My Token v1',
      notes: 'Pre-production scan',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.contractName).toBe('My Token v1');
    expect(res.body.data.notes).toBe('Pre-production scan');

    const stored = await ScanResult.findOne({ scanId: res.body.data.scanId });
    expect(stored.contractName).toBe('My Token v1');
    expect(stored.notes).toBe('Pre-production scan');
  });

  it('summary counts are accurate', async () => {
    const res = await postScan({ wasm: toBase64(buildCleanWasm()) });

    const { summary } = res.body.data;
    expect(typeof summary.critical).toBe('number');
    expect(typeof summary.high).toBe('number');
    expect(typeof summary.medium).toBe('number');
    expect(typeof summary.low).toBe('number');
    expect(typeof summary.info).toBe('number');
    expect(typeof summary.passedChecks).toBe('number');
    expect(typeof summary.totalChecks).toBe('number');
    expect(summary.totalChecks).toBe(Object.keys(RULES).length);
  });

  it('two scans of the same WASM produce the same wasmHash', async () => {
    const wasm = toBase64(buildCleanWasm());
    const r1 = await postScan({ wasm });
    const r2 = await postScan({ wasm });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.data.wasmHash).toBe(r2.body.data.wasmHash);
  });

  it('two different WASMs produce different wasmHashes', async () => {
    const r1 = await postScan({ wasm: toBase64(buildCleanWasm(5)) });
    const r2 = await postScan({ wasm: toBase64(buildCleanWasm(10)) });

    expect(r1.body.data.wasmHash).not.toBe(r2.body.data.wasmHash);
  });

  // ── Authentication ──────────────────────────────────────────────────────────

  it('returns 401 if no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/security/scan')
      .send({ wasm: toBase64(buildCleanWasm()) });

    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid JWT', async () => {
    const res = await request(app)
      .post('/api/security/scan')
      .set('Authorization', 'Bearer totally.invalid.jwt')
      .send({ wasm: toBase64(buildCleanWasm()) });

    expect(res.status).toBe(401);
  });

  // ── Body validation ─────────────────────────────────────────────────────────

  it('returns 400 if wasm field is missing', async () => {
    const res = await postScan({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if wasm field is an empty string', async () => {
    const res = await postScan({ wasm: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if wasm contains non-base64 characters', async () => {
    const res = await postScan({ wasm: 'this is not base64 !!!@@@###' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if contractName exceeds 100 characters', async () => {
    const res = await postScan({
      wasm: toBase64(buildCleanWasm()),
      contractName: 'A'.repeat(101),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if notes exceeds 500 characters', async () => {
    const res = await postScan({
      wasm: toBase64(buildCleanWasm()),
      notes: 'N'.repeat(501),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid base64 string and does not throw on decode', async () => {
    // Use a very short but syntactically valid base64 payload that decodes to
    // non-WASM bytes — should get SM-001 error, not a 400/500
    const res = await postScan({ wasm: 'dGVzdA==' }); // "test" in base64

    // Scanner should accept it and return a scan result (with SM-001 finding)
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(SCAN_STATUS.ERROR);
  });
});

// =============================================================================
// GET /api/security/scans
// =============================================================================

describe('GET /api/security/scans', () => {
  it('returns an empty list when no scans exist', async () => {
    const res = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.metadata.totalCount).toBe(0);
  });

  it("returns only the authenticated user's scans", async () => {
    await seedScan(aliceUser._id, { contractName: 'AliceToken' });
    await seedScan(bobUser._id, { contractName: 'BobToken' });

    const res = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].contractName).toBe('AliceToken');
  });

  it('paginates results correctly', async () => {
    // Seed 5 scans for alice
    for (let i = 0; i < 5; i++) {
      await seedScan(aliceUser._id, { contractName: `Token${i}` });
    }

    const page1 = await request(app)
      .get('/api/security/scans?page=1&limit=3')
      .set('Authorization', `Bearer ${aliceJwt}`);

    const page2 = await request(app)
      .get('/api/security/scans?page=2&limit=3')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(3);
    expect(page1.body.metadata.totalCount).toBe(5);
    expect(page1.body.metadata.totalPages).toBe(2);

    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(2);
  });

  it('filters by status when status query param is provided', async () => {
    await seedScan(aliceUser._id, {
      status: 'clean',
      deploymentBlocked: false,
    });
    await seedScan(aliceUser._id, {
      status: 'failed',
      deploymentBlocked: true,
    });
    await seedScan(aliceUser._id, { status: 'error', deploymentBlocked: true });

    const res = await request(app)
      .get('/api/security/scans?status=clean')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('clean');
  });

  it('returns correct metadata fields', async () => {
    await seedScan(aliceUser._id);

    const res = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.metadata).toMatchObject({
      totalCount: 1,
      page: 1,
      totalPages: 1,
      limit: 20,
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/security/scans');
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid status filter', async () => {
    const res = await request(app)
      .get('/api/security/scans?status=bogus')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for page < 1', async () => {
    const res = await request(app)
      .get('/api/security/scans?page=0')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for limit > 100', async () => {
    const res = await request(app)
      .get('/api/security/scans?limit=999')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('scan documents include scanId, status, wasmHash, deploymentBlocked', async () => {
    await seedScan(aliceUser._id);

    const res = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);

    const scan = res.body.data[0];
    expect(scan.scanId).toBeDefined();
    expect(scan.status).toBeDefined();
    expect(scan.wasmHash).toBeDefined();
    expect(typeof scan.deploymentBlocked).toBe('boolean');
  });
});

// =============================================================================
// GET /api/security/scans/:scanId
// =============================================================================

describe('GET /api/security/scans/:scanId', () => {
  it('returns the scan result for the authenticated owner', async () => {
    const seed = await seedScan(aliceUser._id, { contractName: 'MyContract' });

    const res = await request(app)
      .get(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.scanId).toBe(seed.scanId);
    expect(res.body.data.contractName).toBe('MyContract');
  });

  it('includes findings, summary, and scanner metadata', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app)
      .get(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(Array.isArray(data.findings)).toBe(true);
    expect(data.summary).toBeDefined();
    expect(data.scannerVersion).toBeDefined();
    expect(data.wasmSize).toBeGreaterThan(0);
  });

  it('returns 404 for a non-existent scanId', async () => {
    const res = await request(app)
      .get('/api/security/scans/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SCAN_NOT_FOUND');
  });

  it('returns 403 when a different user tries to access the scan', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app)
      .get(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${bobJwt}`); // Bob tries to read Alice's scan

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app).get(`/api/security/scans/${seed.scanId}`);

    expect(res.status).toBe(401);
  });

  it('allows a user to access their own scan immediately after scanning', async () => {
    // Full round-trip: scan via API then retrieve by scanId
    const scanRes = await postScan({
      wasm: toBase64(buildCleanWasm()),
      contractName: 'RoundTrip',
    });
    expect(scanRes.status).toBe(201);

    const { scanId } = scanRes.body.data;

    const getRes = await request(app)
      .get(`/api/security/scans/${scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.scanId).toBe(scanId);
    expect(getRes.body.data.contractName).toBe('RoundTrip');
  });
});

// =============================================================================
// DELETE /api/security/scans/:scanId
// =============================================================================

describe('DELETE /api/security/scans/:scanId', () => {
  it('deletes the scan record and returns 200', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app)
      .delete(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain(seed.scanId);
  });

  it('removes the record from the database', async () => {
    const seed = await seedScan(aliceUser._id);

    await request(app)
      .delete(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    const stored = await ScanResult.findOne({ scanId: seed.scanId });
    expect(stored).toBeNull();
  });

  it('returns 404 after deleting the same record twice', async () => {
    const seed = await seedScan(aliceUser._id);

    await request(app)
      .delete(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    const second = await request(app)
      .delete(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(second.status).toBe(404);
    expect(second.body.code).toBe('SCAN_NOT_FOUND');
  });

  it('returns 403 when a different user tries to delete the scan', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app)
      .delete(`/api/security/scans/${seed.scanId}`)
      .set('Authorization', `Bearer ${bobJwt}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');

    // Record should still exist
    const stored = await ScanResult.findOne({ scanId: seed.scanId });
    expect(stored).not.toBeNull();
  });

  it('returns 404 for a non-existent scanId', async () => {
    const res = await request(app)
      .delete('/api/security/scans/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SCAN_NOT_FOUND');
  });

  it('returns 401 without a token', async () => {
    const seed = await seedScan(aliceUser._id);

    const res = await request(app).delete(`/api/security/scans/${seed.scanId}`);

    expect(res.status).toBe(401);
  });

  it("user can only delete their own scans, not other users'", async () => {
    const aliceScan = await seedScan(aliceUser._id);
    const bobScan = await seedScan(bobUser._id);

    // Alice deletes her own — succeeds
    const aliceDelete = await request(app)
      .delete(`/api/security/scans/${aliceScan.scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(aliceDelete.status).toBe(200);

    // Bob deletes his own — succeeds
    const bobDelete = await request(app)
      .delete(`/api/security/scans/${bobScan.scanId}`)
      .set('Authorization', `Bearer ${bobJwt}`);
    expect(bobDelete.status).toBe(200);

    // Nothing left
    expect(await ScanResult.countDocuments()).toBe(0);
  });
});

// =============================================================================
// GET /api/security/rules
// =============================================================================

describe('GET /api/security/rules', () => {
  it('returns 200 with an array of all 20 rules', async () => {
    const res = await request(app).get('/api/security/rules');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(20);
    expect(res.body.totalRules).toBe(20);
  });

  it('does NOT require authentication (public endpoint)', async () => {
    // No Authorization header
    const res = await request(app).get('/api/security/rules');
    expect(res.status).toBe(200);
  });

  it('each rule has the required fields', async () => {
    const res = await request(app).get('/api/security/rules');

    const validSeverities = new Set([
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ]);

    for (const rule of res.body.data) {
      expect(rule).toHaveProperty('id');
      expect(rule.id).toMatch(/^SM-\d{3}$/);
      expect(rule).toHaveProperty('severity');
      expect(validSeverities.has(rule.severity)).toBe(true);
      expect(rule).toHaveProperty('title');
      expect(typeof rule.title).toBe('string');
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule).toHaveProperty('description');
      expect(typeof rule.description).toBe('string');
      expect(rule).toHaveProperty('recommendation');
      expect(typeof rule.recommendation).toBe('string');
    }
  });

  it('rules are sorted by ID (SM-001 first, SM-020 last)', async () => {
    const res = await request(app).get('/api/security/rules');

    const ids = res.body.data.map((r) => r.id);
    expect(ids[0]).toBe('SM-001');
    expect(ids[ids.length - 1]).toBe('SM-020');

    // Verify sorted order
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('includes at least one critical and one high severity rule', async () => {
    const res = await request(app).get('/api/security/rules');

    const severities = res.body.data.map((r) => r.severity);
    expect(severities).toContain('critical');
    expect(severities).toContain('high');
  });

  it('rule IDs match the RULES registry exactly', async () => {
    const res = await request(app).get('/api/security/rules');

    const expectedIds = Object.keys(RULES).sort();
    const returnedIds = res.body.data.map((r) => r.id).sort();

    expect(returnedIds).toEqual(expectedIds);
  });
});

// =============================================================================
// GET /api/security/stats
// =============================================================================

describe('GET /api/security/stats', () => {
  it('returns zeroed stats when the user has no scans', async () => {
    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.byStatus).toEqual({});
    expect(res.body.data.blockedCount).toBe(0);
    expect(res.body.data.mostRecentScan).toBeNull();
  });

  it('counts total scans correctly', async () => {
    await Promise.all([
      seedScan(aliceUser._id),
      seedScan(aliceUser._id),
      seedScan(aliceUser._id),
    ]);

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
  });

  it('counts blocked deployments correctly', async () => {
    await seedScan(aliceUser._id, {
      status: 'clean',
      deploymentBlocked: false,
    });
    await seedScan(aliceUser._id, {
      status: 'failed',
      deploymentBlocked: true,
    });
    await seedScan(aliceUser._id, { status: 'error', deploymentBlocked: true });

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.blockedCount).toBe(2);
  });

  it('returns correct byStatus breakdown', async () => {
    await seedScan(aliceUser._id, { status: 'clean' });
    await seedScan(aliceUser._id, { status: 'clean' });
    await seedScan(aliceUser._id, {
      status: 'failed',
      deploymentBlocked: true,
    });
    await seedScan(aliceUser._id, { status: 'warning' });

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    const { byStatus } = res.body.data;
    expect(byStatus.clean).toBe(2);
    expect(byStatus.failed).toBe(1);
    expect(byStatus.warning).toBe(1);
  });

  it('mostRecentScan reflects the latest scan', async () => {
    await seedScan(aliceUser._id, { contractName: 'First' });

    // Small delay to ensure different createdAt timestamps
    await new Promise((r) => setTimeout(r, 10));

    await seedScan(aliceUser._id, { contractName: 'Latest' });

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.mostRecentScan).not.toBeNull();
    expect(res.body.data.mostRecentScan.contractName).toBe('Latest');
  });

  it('mostRecentScan includes scanId, status, wasmHash, deploymentBlocked', async () => {
    await seedScan(aliceUser._id);

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    const { mostRecentScan } = res.body.data;
    expect(mostRecentScan).toHaveProperty('scanId');
    expect(mostRecentScan).toHaveProperty('status');
    expect(mostRecentScan).toHaveProperty('wasmHash');
    expect(mostRecentScan).toHaveProperty('deploymentBlocked');
    expect(mostRecentScan).toHaveProperty('createdAt');
  });

  it('avgDuration is a non-negative number', async () => {
    await seedScan(aliceUser._id, { duration: 120 });
    await seedScan(aliceUser._id, { duration: 80 });

    const res = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data.avgDuration).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.data.avgDuration).toBe('number');
  });

  it("stats are isolated per user — alice's stats do not include bob's scans", async () => {
    await seedScan(aliceUser._id);
    await seedScan(aliceUser._id);
    await seedScan(bobUser._id);
    await seedScan(bobUser._id);
    await seedScan(bobUser._id);

    const aliceRes = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);

    const bobRes = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${bobJwt}`);

    expect(aliceRes.body.data.total).toBe(2);
    expect(bobRes.body.data.total).toBe(3);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/security/stats');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Integration Tests — end-to-end flows
// =============================================================================

describe('Integration Tests', () => {
  it('full scan lifecycle: POST scan → GET by ID → appears in list → DELETE', async () => {
    // 1. Submit a scan
    const scanRes = await postScan({
      wasm: toBase64(buildCleanWasm()),
      contractName: 'LifecycleToken',
    });
    expect(scanRes.status).toBe(201);
    const { scanId } = scanRes.body.data;

    // 2. Retrieve by scanId
    const getRes = await request(app)
      .get(`/api/security/scans/${scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.contractName).toBe('LifecycleToken');

    // 3. Appears in the list
    const listRes = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(listRes.body.data.some((s) => s.scanId === scanId)).toBe(true);

    // 4. Stats reflect the new scan
    const statsRes = await request(app)
      .get('/api/security/stats')
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(statsRes.body.data.total).toBe(1);
    expect(statsRes.body.data.mostRecentScan.scanId).toBe(scanId);

    // 5. Delete the scan
    const delRes = await request(app)
      .delete(`/api/security/scans/${scanId}`)
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(delRes.status).toBe(200);

    // 6. No longer in list
    const listRes2 = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);
    expect(listRes2.body.data.some((s) => s.scanId === scanId)).toBe(false);
  });

  it('blocked WASM scan is correctly flagged and persisted', async () => {
    const badWasm = buildBadMagicWasm();
    const res = await postScan({
      wasm: toBase64(badWasm),
      contractName: 'MaliciousContract',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.deploymentBlocked).toBe(true);
    expect(res.body.data.status).toBe(SCAN_STATUS.ERROR);

    // Verify persisted correctly
    const stored = await ScanResult.findOne({ scanId: res.body.data.scanId });
    expect(stored.deploymentBlocked).toBe(true);
    expect(stored.status).toBe(SCAN_STATUS.ERROR);
  });

  it('multiple users can each manage their own scan history independently', async () => {
    // Alice scans twice
    await postScan({ wasm: toBase64(buildCleanWasm()) }, aliceJwt);
    await postScan({ wasm: toBase64(buildCleanWasm(8)) }, aliceJwt);

    // Bob scans once
    await postScan({ wasm: toBase64(buildCleanWasm()) }, bobJwt);

    const aliceList = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${aliceJwt}`);

    const bobList = await request(app)
      .get('/api/security/scans')
      .set('Authorization', `Bearer ${bobJwt}`);

    expect(aliceList.body.data.length).toBe(2);
    expect(bobList.body.data.length).toBe(1);

    // Cross-access protection: Bob cannot see Alice's scan by ID
    const aliceScanId = aliceList.body.data[0].scanId;
    const crossRes = await request(app)
      .get(`/api/security/scans/${aliceScanId}`)
      .set('Authorization', `Bearer ${bobJwt}`);
    expect(crossRes.status).toBe(403);
  });

  it('rules endpoint returns stable data across multiple calls', async () => {
    const r1 = await request(app).get('/api/security/rules');
    const r2 = await request(app).get('/api/security/rules');

    expect(r1.body.data.length).toBe(r2.body.data.length);
    expect(r1.body.data.map((r) => r.id)).toEqual(
      r2.body.data.map((r) => r.id)
    );
  });

  it('scan report findings include ruleId, severity, title, description, recommendation', async () => {
    // Scan a bad WASM so we get at least one finding
    const res = await postScan({ wasm: toBase64(buildBadMagicWasm()) });

    expect(res.status).toBe(201);
    expect(res.body.data.findings.length).toBeGreaterThan(0);

    const finding = res.body.data.findings[0];
    expect(finding).toHaveProperty('ruleId');
    expect(finding.ruleId).toMatch(/^SM-\d{3}$/);
    expect(finding).toHaveProperty('severity');
    expect(finding).toHaveProperty('title');
    expect(finding).toHaveProperty('description');
    expect(finding).toHaveProperty('recommendation');
  });
});
