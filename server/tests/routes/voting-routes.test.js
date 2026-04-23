/**
 * @title Voting Routes — Comprehensive Test Suite
 * @author SoroMint Team
 * @notice Covers all voting API endpoints:
 *   GET/POST /proposals, GET/PATCH/cancel per proposal,
 *   POST/GET votes, GET results, GET voting-power.
 *
 * @dev Uses MongoMemoryReplSet (single-node replica set) so mongoose
 *      transactions inside castVote work correctly.
 *      Test users are seeded with Token documents so voting-power
 *      checks reflect realistic conditions without mocking.
 */

'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const User = require('../../models/User');
const Token = require('../../models/Token');
const Proposal = require('../../models/Proposal');
const Vote = require('../../models/Vote');
const { generateToken } = require('../../middleware/auth');
const { errorHandler } = require('../../middleware/error-handler');
const { createVotingRouter } = require('../../routes/voting-routes');

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures — valid Stellar addresses
// ─────────────────────────────────────────────────────────────────────────────

/** Alice — owns 3 token contracts, general voting power = 3 */
const PK1 = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
/** Bob — owns 1 token contract, general voting power = 1 */
const PK2 = 'GA2DQGWZTIICWQ7MZ5VZ6CKKXQOGCDHUUFIFO7YUG6SGX63BVG433GZD';
/** Charlie — owns no tokens, general voting power = 0 */
const PK3 = 'GAMDBSITFGKPOC6ZFLP7HXJFFQMQYMIOXJEFYRBZKM6XWJFFM6SXXHCV';

/** Owned by Alice → used for contract-scoped tests */
const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** Owned by Alice (second token) */
const CONTRACT_B = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
/** Owned by Alice (third token) */
const CONTRACT_C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
/** Owned by Bob */
const CONTRACT_D = 'CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
/** Owned by nobody — for zero-power scoped tests */
const CONTRACT_NONE = 'CEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';

const INVALID_PK = 'XBADKEY';
const INVALID_CONTRACT = 'GBADCONTRACT';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let mongoServer;
let app;
let jwt1, jwt2, jwt3;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** ISO datetime offset from now (positive = future, negative = past). */
const dt = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/** A valid proposal body for POST /api/proposals (times in the future). */
const validBody = (overrides = {}) => ({
  title: 'Should we raise the max symbol length?',
  description: 'A full discussion of raising the token symbol cap from 12 to 20 characters.',
  choices: ['Yes', 'No', 'Abstain'],
  startTime: dt(120_000),       // 2 min from now
  endTime:   dt(3_720_000),     // ~1 h 2 min from now
  ...overrides,
});

/**
 * Seeds an ACTIVE proposal directly in the DB (bypasses route time validation).
 * startTime is in the past; endTime is in the future.
 */
const seedActive = async (overrides = {}) => {
  const doc = new Proposal({
    title: 'Active: governance update',
    description: 'This proposal is currently open for voting.',
    creator: PK1,
    choices: ['For', 'Against', 'Abstain'],
    startTime: new Date(Date.now() - 60_000),
    endTime:   new Date(Date.now() + 3_600_000),
    contractId: null,
    ...overrides,
  });
  doc.syncStatus();
  await doc.save();
  return doc;
};

/** Seeds a PENDING proposal (startTime far in the future). */
const seedPending = async (overrides = {}) => {
  const doc = new Proposal({
    title: 'Pending: fee restructure',
    description: 'A proposal that has not started yet.',
    creator: PK1,
    choices: ['Yes', 'No'],
    startTime: new Date(Date.now() + 3_600_000),
    endTime:   new Date(Date.now() + 7_200_000),
    ...overrides,
  });
  doc.syncStatus();
  await doc.save();
  return doc;
};

/** Seeds a CLOSED proposal (both times in the past). */
const seedClosed = async (overrides = {}) => {
  const doc = new Proposal({
    title: 'Closed: logo change',
    description: 'A proposal whose voting window has ended.',
    creator: PK1,
    choices: ['Approve', 'Reject'],
    startTime: new Date(Date.now() - 7_200_000),
    endTime:   new Date(Date.now() - 3_600_000),
    status: 'closed',
    ...overrides,
  });
  await doc.save();
  return doc;
};

/** Seeds a CANCELLED proposal. */
const seedCancelled = async (overrides = {}) => {
  const doc = await seedPending({ ...overrides });
  doc.status = 'cancelled';
  await doc.save();
  return doc;
};

/**
 * Convenience: cast a vote directly via the API.
 * Returns the supertest response.
 */
const apiVote = (proposalId, choice, jwt) =>
  request(app)
    .post(`/api/proposals/${proposalId}/votes`)
    .set('Authorization', `Bearer ${jwt}`)
    .send({ choice });

// ─────────────────────────────────────────────────────────────────────────────
// Suite setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Replica set required for mongoose transactions (used in castVote).
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());

  process.env.JWT_SECRET     = 'test-voting-secret-key-xyz';
  process.env.JWT_EXPIRES_IN = '1h';

  // Build the Express app
  app = express();
  app.use(express.json());
  app.use((_req, _res, next) => { _req.correlationId = 'test-cid'; next(); });
  app.use('/api', createVotingRouter());
  app.use(errorHandler);

  // Seed users
  await User.create([
    { publicKey: PK1, username: 'alice' },
    { publicKey: PK2, username: 'bob' },
    { publicKey: PK3, username: 'charlie' },
  ]);

  // Seed tokens — determines voting power
  await Token.create([
    // Alice: 3 contracts (CONTRACT_A, B, C)
    { name: 'AliceToken1', symbol: 'AT1', contractId: CONTRACT_A, ownerPublicKey: PK1 },
    { name: 'AliceToken2', symbol: 'AT2', contractId: CONTRACT_B, ownerPublicKey: PK1 },
    { name: 'AliceToken3', symbol: 'AT3', contractId: CONTRACT_C, ownerPublicKey: PK1 },
    // Bob: 1 contract (CONTRACT_D)
    { name: 'BobToken1',   symbol: 'BT1', contractId: CONTRACT_D,    ownerPublicKey: PK2 },
    // Charlie: no tokens → voting power = 0
  ]);

  jwt1 = generateToken(PK1, 'alice');
  jwt2 = generateToken(PK2, 'bob');
  jwt3 = generateToken(PK3, 'charlie');
});

beforeEach(async () => {
  await Proposal.deleteMany({});
  await Vote.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
});

// =============================================================================
// GET /api/proposals
// =============================================================================

describe('GET /api/proposals', () => {
  it('returns an empty list when no proposals exist', async () => {
    const res = await request(app).get('/api/proposals');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.metadata.totalCount).toBe(0);
  });

  it('returns all proposals with default pagination', async () => {
    await Promise.all([seedActive(), seedPending(), seedClosed()]);

    const res = await request(app).get('/api/proposals');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.metadata.totalCount).toBe(3);
    expect(res.body.metadata.page).toBe(1);
  });

  it('filters by status=active', async () => {
    await Promise.all([seedActive(), seedPending(), seedClosed()]);

    const res = await request(app).get('/api/proposals?status=active');

    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.status === 'active')).toBe(true);
  });

  it('filters by status=pending', async () => {
    await Promise.all([seedActive(), seedPending(), seedPending()]);

    const res = await request(app).get('/api/proposals?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((p) => p.status === 'pending')).toBe(true);
  });

  it('filters by status=closed', async () => {
    await Promise.all([seedActive(), seedClosed(), seedClosed()]);

    const res = await request(app).get('/api/proposals?status=closed');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('filters by status=cancelled', async () => {
    await Promise.all([seedActive(), seedCancelled()]);

    const res = await request(app).get('/api/proposals?status=cancelled');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('cancelled');
  });

  it('status=all returns every proposal regardless of status', async () => {
    await Promise.all([seedActive(), seedPending(), seedClosed(), seedCancelled()]);

    const res = await request(app).get('/api/proposals?status=all');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
  });

  it('filters by creator', async () => {
    await seedActive({ creator: PK1 });
    await seedActive({ creator: PK2 });

    const res = await request(app).get(`/api/proposals?creator=${PK1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((p) => p.creator === PK1)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it('filters by contractId', async () => {
    await seedActive({ contractId: CONTRACT_A });
    await seedActive({ contractId: null });

    const res = await request(app).get(`/api/proposals?contractId=${CONTRACT_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].contractId).toBe(CONTRACT_A);
  });

  it('paginates correctly', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => seedActive({ title: `Proposal ${i}` })));

    const page1 = await request(app).get('/api/proposals?page=1&limit=3');
    const page2 = await request(app).get('/api/proposals?page=2&limit=3');

    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(3);
    expect(page1.body.metadata.totalPages).toBe(2);

    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(2);
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app).get('/api/proposals?status=bogus');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for page < 1', async () => {
    const res = await request(app).get('/api/proposals?page=0');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for limit > 100', async () => {
    const res = await request(app).get('/api/proposals?limit=999');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// =============================================================================
// POST /api/proposals
// =============================================================================

describe('POST /api/proposals', () => {
  it('creates a proposal successfully', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Should we raise the max symbol length?');
    expect(res.body.data.creator).toBe(PK1);
    expect(res.body.data.choices).toEqual(['Yes', 'No', 'Abstain']);
    expect(res.body.data.status).toBe('pending');
  });

  it('always uses the authenticated key as creator (ignores body creator)', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ ...validBody(), creator: PK2 }); // try to impersonate PK2

    expect(res.status).toBe(201);
    expect(res.body.data.creator).toBe(PK1); // must be PK1 (JWT identity)
  });

  it('initialises the tally with one entry per choice', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.data.tally.length).toBe(3);
    expect(res.body.data.tally[0].label).toBe('Yes');
    expect(res.body.data.tally[0].totalPower).toBe(0);
    expect(res.body.data.tally[0].voteCount).toBe(0);
  });

  it('creates a contract-scoped proposal', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ contractId: CONTRACT_A }));

    expect(res.status).toBe(201);
    expect(res.body.data.contractId).toBe(CONTRACT_A);
  });

  it('creates a proposal with optional tags and discussionUrl', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(
        validBody({
          tags: ['governance', 'fees'],
          discussionUrl: 'https://forum.soromint.app/1',
        })
      );

    expect(res.status).toBe(201);
    expect(res.body.data.tags).toContain('governance');
    expect(res.body.data.discussionUrl).toBe('https://forum.soromint.app/1');
  });

  it('returns 401 if no token provided', async () => {
    const res = await request(app).post('/api/proposals').send(validBody());

    expect(res.status).toBe(401);
  });

  it('returns 400 if title is missing', async () => {
    const body = validBody();
    delete body.title;

    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if title is too short', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ title: 'Hi' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if description is too short', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ description: 'Too short' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if fewer than 2 choices supplied', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ choices: ['Only one'] }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if more than 10 choices supplied', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ choices: Array.from({ length: 11 }, (_, i) => `Option ${i}`) }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for duplicate choices (case-insensitive)', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ choices: ['Yes', 'yes', 'No'] }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if startTime is in the past', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ startTime: dt(-3_600_000) }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if endTime is before startTime', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ endTime: dt(60_000) })); // before startTime(dt(120_000))

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 if voting window is shorter than 1 hour', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(
        validBody({
          startTime: dt(60_000),
          endTime:   dt(1_800_000), // only 29 min window
        })
      );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an invalid contractId format', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody({ contractId: 'NOTACONTRACT' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// =============================================================================
// GET /api/proposals/:id
// =============================================================================

describe('GET /api/proposals/:id', () => {
  it('returns the proposal document', async () => {
    const proposal = await seedActive();

    const res = await request(app).get(`/api/proposals/${proposal._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(String(proposal._id));
    expect(res.body.data.title).toBe(proposal.title);
  });

  it('includes the tally in the response', async () => {
    const proposal = await seedActive();

    const res = await request(app).get(`/api/proposals/${proposal._id}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.tally)).toBe(true);
    expect(res.body.data.tally.length).toBe(proposal.choices.length);
  });

  it('returns 404 for a non-existent proposal ID', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app).get(`/api/proposals/${fakeId}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PROPOSAL_NOT_FOUND');
  });

  it('returns 400 for a malformed ObjectId', async () => {
    const res = await request(app).get('/api/proposals/not-an-id');

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// PATCH /api/proposals/:id
// =============================================================================

describe('PATCH /api/proposals/:id', () => {
  it('updates title and description while pending', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'Updated title here', description: 'Updated description, long enough to pass validation.' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated title here');
  });

  it('updates tags and discussionUrl', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ tags: ['important', 'fees'], discussionUrl: 'https://example.com/discuss' });

    expect(res.status).toBe(200);
    expect(res.body.data.tags).toContain('important');
    expect(res.body.data.discussionUrl).toBe('https://example.com/discuss');
  });

  it('returns 401 if not authenticated', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .send({ title: 'Unauthorised update' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-creator tries to update', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt2}`) // PK2 is not creator
      .send({ title: 'Hijacked title here yeah' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 409 when proposal is active (not editable)', async () => {
    const proposal = await seedActive({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'Cannot edit active proposal' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_NOT_EDITABLE');
  });

  it('returns 409 when proposal is closed (not editable)', async () => {
    const proposal = await seedClosed({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'Cannot edit closed proposal' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_NOT_EDITABLE');
  });

  it('returns 400 if updated title is too short', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'Hi' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a non-existent proposal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .patch(`/api/proposals/${fakeId}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'No such proposal exists here' });

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// POST /api/proposals/:id/cancel
// =============================================================================

describe('POST /api/proposals/:id/cancel', () => {
  it('cancels a pending proposal (creator)', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('cancels an active proposal (creator)', async () => {
    const proposal = await seedActive({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('returns 401 if not authenticated', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`);

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-creator tries to cancel', async () => {
    const proposal = await seedPending({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt2}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 409 when cancelling an already-closed proposal', async () => {
    const proposal = await seedClosed({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_ALREADY_CLOSED');
  });

  it('returns 409 when cancelling an already-cancelled proposal', async () => {
    const proposal = await seedCancelled({ creator: PK1 });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_ALREADY_CANCELLED');
  });

  it('returns 404 for a non-existent proposal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/proposals/${fakeId}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// POST /api/proposals/:id/votes
// =============================================================================

describe('POST /api/proposals/:id/votes', () => {
  it('casts a vote successfully (alice, power=3)', async () => {
    const proposal = await seedActive();

    const res = await apiVote(proposal._id, 0, jwt1);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.votingPower).toBe(3);
    expect(res.body.data.choiceLabel).toBe('For');
    expect(res.body.data.vote.voter).toBe(PK1);
    expect(res.body.data.vote.choice).toBe(0);
  });

  it('casts a vote successfully (bob, power=1)', async () => {
    const proposal = await seedActive();

    const res = await apiVote(proposal._id, 1, jwt2);

    expect(res.status).toBe(201);
    expect(res.body.data.votingPower).toBe(1);
    expect(res.body.data.choiceLabel).toBe('Against');
  });

  it('updates the tally on the proposal document', async () => {
    const proposal = await seedActive();

    await apiVote(proposal._id, 0, jwt1); // alice: power=3, choice=0

    const updated = await Proposal.findById(proposal._id);
    expect(updated.voteCount).toBe(1);
    expect(updated.totalVotingPower).toBe(3);
    expect(updated.tally[0].totalPower).toBe(3);
    expect(updated.tally[0].voteCount).toBe(1);
    expect(updated.tally[1].totalPower).toBe(0);
  });

  it('supports all valid choice indices', async () => {
    const proposal = await seedActive();

    // alice votes choice 2 (Abstain)
    const res = await apiVote(proposal._id, 2, jwt1);
    expect(res.status).toBe(201);
    expect(res.body.data.choiceLabel).toBe('Abstain');
  });

  it('accepts optional signedMessage field', async () => {
    const proposal = await seedActive();

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/votes`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ choice: 0, signedMessage: 'base64signedxdrhere' });

    expect(res.status).toBe(201);
    expect(res.body.data.vote.signedMessage).toBe('base64signedxdrhere');
  });

  it('returns 401 if not authenticated', async () => {
    const proposal = await seedActive();

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/votes`)
      .send({ choice: 0 });

    expect(res.status).toBe(401);
  });

  it('returns 409 when voting on a proposal not yet open (pending)', async () => {
    const proposal = await seedPending();

    const res = await apiVote(proposal._id, 0, jwt1);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VOTING_NOT_OPEN');
  });

  it('returns 409 when voting on a closed proposal', async () => {
    const proposal = await seedClosed();

    const res = await apiVote(proposal._id, 0, jwt1);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VOTING_NOT_OPEN');
  });

  it('returns 409 when voting on a cancelled proposal', async () => {
    const proposal = await seedCancelled();

    const res = await apiVote(proposal._id, 0, jwt1);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VOTING_NOT_OPEN');
  });

  it('returns 409 when the same wallet votes twice (replay prevention)', async () => {
    const proposal = await seedActive();

    await apiVote(proposal._id, 0, jwt1);
    const res = await apiVote(proposal._id, 1, jwt1); // second attempt

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_VOTED');
  });

  it('returns 400 for an out-of-range choice index', async () => {
    const proposal = await seedActive(); // 3 choices → valid: 0, 1, 2

    const res = await apiVote(proposal._id, 99, jwt1);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CHOICE');
  });

  it('returns 400 for a negative choice index', async () => {
    const proposal = await seedActive();

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/votes`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ choice: -1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when choice is missing', async () => {
    const proposal = await seedActive();

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/votes`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when voter has no voting power (charlie, zero tokens)', async () => {
    const proposal = await seedActive();

    const res = await apiVote(proposal._id, 0, jwt3); // charlie has 0 tokens

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_VOTING_POWER');
  });

  it('returns 403 when voter does not own the scoped contract', async () => {
    // Bob only owns CONTRACT_D, not CONTRACT_A
    const proposal = await seedActive({ contractId: CONTRACT_A });

    const res = await apiVote(proposal._id, 0, jwt2);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_VOTING_POWER');
  });

  it('allows voting on a contract-scoped proposal for the owner', async () => {
    // Alice owns CONTRACT_A → power = 1 for scoped proposal
    const proposal = await seedActive({ contractId: CONTRACT_A });

    const res = await apiVote(proposal._id, 0, jwt1);

    expect(res.status).toBe(201);
    expect(res.body.data.votingPower).toBe(1);
  });

  it('allows a different wallet to vote on a contract they own', async () => {
    // Bob owns CONTRACT_D → can vote on a CONTRACT_D-scoped proposal
    const proposal = await seedActive({ contractId: CONTRACT_D });

    const res = await apiVote(proposal._id, 1, jwt2);

    expect(res.status).toBe(201);
    expect(res.body.data.votingPower).toBe(1);
  });

  it('returns 404 for a non-existent proposal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await apiVote(fakeId, 0, jwt1);

    expect(res.status).toBe(404);
  });

  it('accumulates tally correctly across multiple voters', async () => {
    const proposal = await seedActive();

    await apiVote(proposal._id, 0, jwt1); // alice: power=3 → For
    await apiVote(proposal._id, 1, jwt2); // bob:   power=1 → Against

    const updated = await Proposal.findById(proposal._id);
    expect(updated.voteCount).toBe(2);
    expect(updated.totalVotingPower).toBe(4);
    expect(updated.tally[0].totalPower).toBe(3); // For
    expect(updated.tally[1].totalPower).toBe(1); // Against
    expect(updated.tally[2].totalPower).toBe(0); // Abstain
  });
});

// =============================================================================
// GET /api/proposals/:id/votes
// =============================================================================

describe('GET /api/proposals/:id/votes', () => {
  it('returns an empty list before any votes are cast', async () => {
    const proposal = await seedActive();

    const res = await request(app).get(`/api/proposals/${proposal._id}/votes`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.metadata.totalCount).toBe(0);
  });

  it('returns votes after they are cast', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1);
    await apiVote(proposal._id, 1, jwt2);

    const res = await request(app).get(`/api/proposals/${proposal._id}/votes`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.metadata.totalCount).toBe(2);
  });

  it('paginates the vote list', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1);
    await apiVote(proposal._id, 1, jwt2);

    const page1 = await request(app)
      .get(`/api/proposals/${proposal._id}/votes?page=1&limit=1`);

    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(1);
    expect(page1.body.metadata.totalPages).toBe(2);
  });

  it('each vote record includes voter, choice, votingPower, and createdAt', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1);

    const res = await request(app).get(`/api/proposals/${proposal._id}/votes`);

    const vote = res.body.data[0];
    expect(vote.voter).toBe(PK1);
    expect(vote.choice).toBe(0);
    expect(vote.votingPower).toBe(3);
    expect(vote.createdAt).toBeDefined();
  });

  it('returns 404 for a non-existent proposal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app).get(`/api/proposals/${fakeId}/votes`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid pagination params', async () => {
    const proposal = await seedActive();

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/votes?limit=999`);

    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/proposals/:id/results
// =============================================================================

describe('GET /api/proposals/:id/results', () => {
  it('returns zero tallies before any votes are cast', async () => {
    const proposal = await seedActive();

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalVoteCount).toBe(0);
    expect(res.body.data.totalVotingPower).toBe(0);
    expect(res.body.data.winningChoice).toBeNull();
    expect(res.body.data.results.every((r) => r.voteCount === 0)).toBe(true);
  });

  it('returns correct per-choice tallies after voting', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1); // alice: power=3, choice=For
    await apiVote(proposal._id, 1, jwt2); // bob:   power=1, choice=Against

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalVoteCount).toBe(2);
    expect(res.body.data.totalVotingPower).toBe(4);

    const forResult = res.body.data.results.find((r) => r.label === 'For');
    const againstResult = res.body.data.results.find((r) => r.label === 'Against');

    expect(forResult.totalPower).toBe(3);
    expect(forResult.voteCount).toBe(1);
    expect(againstResult.totalPower).toBe(1);
    expect(againstResult.voteCount).toBe(1);
  });

  it('calculates correct percentages', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1); // 3/4 = 75%
    await apiVote(proposal._id, 1, jwt2); // 1/4 = 25%

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    const forResult     = res.body.data.results.find((r) => r.label === 'For');
    const againstResult = res.body.data.results.find((r) => r.label === 'Against');
    const abstainResult = res.body.data.results.find((r) => r.label === 'Abstain');

    expect(forResult.percentage).toBe(75);
    expect(againstResult.percentage).toBe(25);
    expect(abstainResult.percentage).toBe(0);
  });

  it('identifies the winning choice by voting power', async () => {
    const proposal = await seedActive();
    await apiVote(proposal._id, 0, jwt1); // alice: power=3
    await apiVote(proposal._id, 1, jwt2); // bob:   power=1

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    expect(res.body.data.winningChoice).not.toBeNull();
    expect(res.body.data.winningChoice.label).toBe('For');
    expect(res.body.data.winningChoice.index).toBe(0);
  });

  it('winningChoice is null when there is a tie', async () => {
    // Create a proposal where two choices tie on total power.
    // We need two voters with equal power: both must own 1 token each.
    const proposal = await seedActive({ contractId: null });

    // Both alice (power=3) and bob (power=1) vote — no tie here.
    // To test a tie we need equal power voters.
    // Seed two extra users with 1 token each and make them vote opposite choices.
    const PK_EVEN_A = 'GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const PK_EVEN_B = 'GCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    await User.create([
      { publicKey: PK_EVEN_A, username: 'even_a' },
      { publicKey: PK_EVEN_B, username: 'even_b' },
    ]);
    await Token.create([
      { name: 'E1', symbol: 'E1', contractId: 'CFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', ownerPublicKey: PK_EVEN_A },
      { name: 'E2', symbol: 'E2', contractId: 'CGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', ownerPublicKey: PK_EVEN_B },
    ]);

    const jwtA = generateToken(PK_EVEN_A, 'even_a');
    const jwtB = generateToken(PK_EVEN_B, 'even_b');

    await apiVote(proposal._id, 0, jwtA); // power=1, choice=For
    await apiVote(proposal._id, 1, jwtB); // power=1, choice=Against

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    expect(res.body.data.winningChoice).toBeNull(); // tie
  });

  it('includes the proposal document in the response', async () => {
    const proposal = await seedActive();

    const res = await request(app).get(`/api/proposals/${proposal._id}/results`);

    expect(res.body.data.proposal).toBeDefined();
    expect(res.body.data.proposal._id).toBe(String(proposal._id));
  });

  it('returns 404 for a non-existent proposal', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app).get(`/api/proposals/${fakeId}/results`);

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// GET /api/voting-power  (authenticated user)
// =============================================================================

describe('GET /api/voting-power', () => {
  it('returns general voting power for alice (3 tokens)', async () => {
    const res = await request(app)
      .get('/api/voting-power')
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBe(PK1);
    expect(res.body.data.votingPower).toBe(3);
    expect(res.body.data.contractId).toBeNull();
  });

  it('returns general voting power for bob (1 token)', async () => {
    const res = await request(app)
      .get('/api/voting-power')
      .set('Authorization', `Bearer ${jwt2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(1);
  });

  it('returns 0 for charlie (no tokens)', async () => {
    const res = await request(app)
      .get('/api/voting-power')
      .set('Authorization', `Bearer ${jwt3}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(0);
  });

  it('returns 1 for alice when scoped to a contract she owns', async () => {
    const res = await request(app)
      .get(`/api/voting-power?contractId=${CONTRACT_A}`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(1);
    expect(res.body.data.contractId).toBe(CONTRACT_A);
  });

  it('returns 0 for bob when scoped to a contract he does not own', async () => {
    const res = await request(app)
      .get(`/api/voting-power?contractId=${CONTRACT_A}`)
      .set('Authorization', `Bearer ${jwt2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(0);
  });

  it('returns 0 for any wallet scoped to a contract nobody owns', async () => {
    const res = await request(app)
      .get(`/api/voting-power?contractId=${CONTRACT_NONE}`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(0);
  });

  it('returns 401 if not authenticated', async () => {
    const res = await request(app).get('/api/voting-power');

    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid contractId format', async () => {
    const res = await request(app)
      .get('/api/voting-power?contractId=INVALID')
      .set('Authorization', `Bearer ${jwt1}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CONTRACT_ID');
  });
});

// =============================================================================
// GET /api/voting-power/:publicKey  (public lookup)
// =============================================================================

describe('GET /api/voting-power/:publicKey', () => {
  it('returns alice\'s voting power publicly', async () => {
    const res = await request(app).get(`/api/voting-power/${PK1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBe(PK1);
    expect(res.body.data.votingPower).toBe(3);
  });

  it('returns bob\'s voting power publicly', async () => {
    const res = await request(app).get(`/api/voting-power/${PK2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(1);
  });

  it('returns 0 for a wallet that owns no tokens', async () => {
    const res = await request(app).get(`/api/voting-power/${PK3}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(0);
  });

  it('returns contract-scoped power publicly', async () => {
    const res = await request(app)
      .get(`/api/voting-power/${PK1}?contractId=${CONTRACT_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data.votingPower).toBe(1);
  });

  it('does not require authentication', async () => {
    // No Authorization header — must still succeed
    const res = await request(app).get(`/api/voting-power/${PK1}`);

    expect(res.status).toBe(200);
  });

  it('returns 400 for an invalid G-address format', async () => {
    const res = await request(app).get(`/api/voting-power/${INVALID_PK}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PUBLIC_KEY');
  });

  it('returns 400 for an invalid contractId', async () => {
    const res = await request(app)
      .get(`/api/voting-power/${PK1}?contractId=${INVALID_CONTRACT}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CONTRACT_ID');
  });
});

// =============================================================================
// Integration Tests — end-to-end flows
// =============================================================================

describe('Integration Tests', () => {
  it('full proposal lifecycle: create → vote → results → cancel rejected after close', async () => {
    // 1. Alice creates a proposal (pending because startTime is in future)
    const createRes = await request(app)
      .post('/api/proposals')
      .set('Authorization', `Bearer ${jwt1}`)
      .send(validBody());

    expect(createRes.status).toBe(201);
    const proposalId = createRes.body.data._id;

    // 2. Seed an active version directly so we can vote on it
    //    (we can't wait 2 minutes in a unit test)
    const activeProposal = await seedActive({ creator: PK1 });

    // 3. Both alice and bob vote
    const vote1 = await apiVote(activeProposal._id, 0, jwt1);
    const vote2 = await apiVote(activeProposal._id, 1, jwt2);
    expect(vote1.status).toBe(201);
    expect(vote2.status).toBe(201);

    // 4. Fetch results — For should win (alice power=3 vs bob power=1)
    const resultsRes = await request(app)
      .get(`/api/proposals/${activeProposal._id}/results`);

    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.data.winningChoice.label).toBe('For');
    expect(resultsRes.body.data.totalVotingPower).toBe(4);

    // 5. Close the proposal manually
    activeProposal.status = 'closed';
    await activeProposal.save();

    // 6. Attempting to cancel a closed proposal must fail
    const cancelRes = await request(app)
      .post(`/api/proposals/${activeProposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.code).toBe('PROPOSAL_ALREADY_CLOSED');
  });

  it('votes from multiple wallets accumulate correctly', async () => {
    const proposal = await seedActive({ choices: ['Alpha', 'Beta'] });

    // alice: power=3 → Alpha
    // bob:   power=1 → Beta
    await apiVote(proposal._id, 0, jwt1);
    await apiVote(proposal._id, 1, jwt2);

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/results`);

    const alpha = res.body.data.results.find((r) => r.label === 'Alpha');
    const beta  = res.body.data.results.find((r) => r.label === 'Beta');

    expect(alpha.totalPower).toBe(3);
    expect(alpha.percentage).toBe(75);
    expect(beta.totalPower).toBe(1);
    expect(beta.percentage).toBe(25);
    expect(res.body.data.winningChoice.label).toBe('Alpha');
  });

  it('a single voter cannot skew results by voting twice', async () => {
    const proposal = await seedActive();

    await apiVote(proposal._id, 0, jwt1); // first vote — succeeds
    await apiVote(proposal._id, 1, jwt1); // second vote — must fail

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/results`);

    expect(res.body.data.totalVoteCount).toBe(1);
    expect(res.body.data.totalVotingPower).toBe(3); // only alice's first vote counts
  });

  it('editing a pending proposal and then cancelling it leaves no orphan votes', async () => {
    const proposal = await seedPending({ creator: PK1 });

    // Update title
    const updateRes = await request(app)
      .patch(`/api/proposals/${proposal._id}`)
      .set('Authorization', `Bearer ${jwt1}`)
      .send({ title: 'Revised proposal title for testing' });

    expect(updateRes.status).toBe(200);

    // Cancel it
    const cancelRes = await request(app)
      .post(`/api/proposals/${proposal._id}/cancel`)
      .set('Authorization', `Bearer ${jwt1}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');

    // No votes should exist (it was never active)
    const voteCount = await Vote.countDocuments({ proposalId: proposal._id });
    expect(voteCount).toBe(0);
  });

  it('charlie (zero power) cannot hijack a high-power vote', async () => {
    const proposal = await seedActive();

    // charlie tries every choice — all must be rejected
    const results = await Promise.all([
      apiVote(proposal._id, 0, jwt3),
      apiVote(proposal._id, 1, jwt3),
      apiVote(proposal._id, 2, jwt3),
    ]);

    for (const res of results) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_VOTING_POWER');
    }

    const voteCount = await Vote.countDocuments({ proposalId: proposal._id });
    expect(voteCount).toBe(0);
  });

  it('contract-scoped voting isolates power correctly', async () => {
    // Only alice owns CONTRACT_A
    const proposal = await seedActive({ contractId: CONTRACT_A, creator: PK1 });

    const aliceVote = await apiVote(proposal._id, 0, jwt1);
    const bobVote   = await apiVote(proposal._id, 0, jwt2); // bob doesn't own CONTRACT_A

    expect(aliceVote.status).toBe(201);
    expect(aliceVote.body.data.votingPower).toBe(1); // scoped → 1
    expect(bobVote.status).toBe(403);
    expect(bobVote.body.code).toBe('INSUFFICIENT_VOTING_POWER');
  });

  it('public listing shows proposals from multiple creators', async () => {
    await seedActive({ creator: PK1, title: 'Alice proposal' });
    await seedActive({ creator: PK2, title: 'Bob proposal' });

    const res = await request(app).get('/api/proposals');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);

    const titles = res.body.data.map((p) => p.title);
    expect(titles).toContain('Alice proposal');
    expect(titles).toContain('Bob proposal');
  });
});
