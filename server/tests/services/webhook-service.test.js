const { sign, dispatch } = require('../../services/webhook-service');
const Webhook = require('../../models/Webhook');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Webhook.deleteMany({});
});

describe('sign()', () => {
  it('produces sha256= prefixed HMAC', () => {
    const sig = sign('mysecret', '{"event":"token.minted"}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('produces different signatures for different secrets', () => {
    const payload = '{"event":"token.minted"}';
    expect(sign('secret1', payload)).not.toBe(sign('secret2', payload));
  });
});

describe('dispatch()', () => {
  it('does not throw when no webhooks are registered', async () => {
    await expect(dispatch('token.minted', { tokenId: 'abc' })).resolves.toBeUndefined();
  });

  it('skips inactive webhooks', async () => {
    await Webhook.create({
      ownerPublicKey: 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP',
      url: 'https://example.com/hook',
      secret: 'supersecretvalue1234',
      events: ['token.minted'],
      active: false,
    });

    // dispatch should resolve without attempting delivery
    await expect(dispatch('token.minted', { tokenId: 'abc' })).resolves.toBeUndefined();
  });
});
