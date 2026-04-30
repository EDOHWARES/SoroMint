const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Stream = require('../../models/Stream');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Stream.deleteMany({});
});

// ── Helper ────────────────────────────────────────────────────────────────────

function makeStream(overrides = {}) {
  return {
    streamId: `stream-${Date.now()}-${Math.random()}`,
    contractId: 'contract-123',
    sender: 'GSENDER',
    recipient: 'GRECIPIENT',
    tokenAddress: 'GTOKEN',
    totalAmount: '1000',
    ratePerLedger: '10',
    startLedger: 100,
    stopLedger: 200,
    createdTxHash: 'tx-hash-123',
    ...overrides,
  };
}

// ── Stream model metadata validation ─────────────────────────────────────────

describe('Stream model — metadata field', () => {
  it('saves a stream with no metadata (defaults to empty)', async () => {
    const stream = await Stream.create(makeStream());
    expect(stream.metadata).toBeDefined();
  });

  it('saves valid metadata with string values', async () => {
    const stream = await Stream.create(
      makeStream({ metadata: new Map([['project', 'Alpha'], ['invoice_id', 'INV-001']]) })
    );
    expect(stream.metadata.get('project')).toBe('Alpha');
    expect(stream.metadata.get('invoice_id')).toBe('INV-001');
  });

  it('saves valid metadata with number and boolean values', async () => {
    const stream = await Stream.create(
      makeStream({ metadata: new Map([['amount', 42], ['active', true]]) })
    );
    expect(stream.metadata.get('amount')).toBe(42);
    expect(stream.metadata.get('active')).toBe(true);
  });

  it('saves valid metadata with null value', async () => {
    const stream = await Stream.create(
      makeStream({ metadata: new Map([['notes', null]]) })
    );
    expect(stream.metadata.get('notes')).toBeNull();
  });

  it('rejects metadata with more than 50 keys', async () => {
    const entries = Array.from({ length: 51 }, (_, i) => [`key${i}`, 'val']);
    await expect(
      Stream.create(makeStream({ metadata: new Map(entries) }))
    ).rejects.toThrow();
  });

  it('rejects metadata with invalid key characters', async () => {
    await expect(
      Stream.create(makeStream({ metadata: new Map([['invalid key!', 'val']]) }))
    ).rejects.toThrow();
  });

  it('rejects metadata with object values', async () => {
    await expect(
      Stream.create(makeStream({ metadata: new Map([['nested', { foo: 'bar' }]]) }))
    ).rejects.toThrow();
  });

  it('rejects metadata with array values', async () => {
    await expect(
      Stream.create(makeStream({ metadata: new Map([['list', [1, 2, 3]]]) }))
    ).rejects.toThrow();
  });

  it('rejects metadata with string value exceeding 512 chars', async () => {
    await expect(
      Stream.create(makeStream({ metadata: new Map([['longval', 'x'.repeat(513)]]) }))
    ).rejects.toThrow();
  });

  it('accepts metadata with string value of exactly 512 chars', async () => {
    const stream = await Stream.create(
      makeStream({ metadata: new Map([['longval', 'x'.repeat(512)]]) })
    );
    expect(stream.metadata.get('longval')).toHaveLength(512);
  });
});

// ── Metadata filtering ────────────────────────────────────────────────────────

describe('Stream model — metadata filtering', () => {
  it('finds streams by metadata key and value', async () => {
    await Stream.create(makeStream({ metadata: new Map([['project', 'Alpha']]) }));
    await Stream.create(makeStream({ metadata: new Map([['project', 'Beta']]) }));

    const results = await Stream.find({ 'metadata.project': 'Alpha' });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.get('project')).toBe('Alpha');
  });

  it('finds streams by metadata key existence', async () => {
    await Stream.create(makeStream({ metadata: new Map([['invoice_id', 'INV-001']]) }));
    await Stream.create(makeStream());

    const results = await Stream.find({ 'metadata.invoice_id': { $exists: true } });
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no streams match metadata filter', async () => {
    await Stream.create(makeStream({ metadata: new Map([['project', 'Alpha']]) }));
    const results = await Stream.find({ 'metadata.project': 'NonExistent' });
    expect(results).toHaveLength(0);
  });
});