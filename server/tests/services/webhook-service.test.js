const http = require('http');
const { EventEmitter } = require('events');

jest.mock('../../models/Webhook', () => ({
  find: jest.fn(),
}));

const Webhook = require('../../models/Webhook');
const { sign, dispatch } = require('../../services/webhook-service');

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
  afterEach(() => {
    jest.restoreAllMocks();
    Webhook.find.mockReset();
  });

  it('does not throw when no webhooks are registered', async () => {
    Webhook.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    await expect(
      dispatch('token.minted', { tokenId: 'abc' })
    ).resolves.toBeUndefined();
  });

  it('skips inactive webhooks by returning only active matches', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    Webhook.find.mockReturnValue({ lean });

    await expect(
      dispatch('token.minted', { tokenId: 'abc' })
    ).resolves.toBeUndefined();
    expect(Webhook.find).toHaveBeenCalledWith({
      events: 'token.minted',
      active: true,
    });
  });

  it('delivers stream webhooks with signed payloads and retries temporary failures', async () => {
    const webhook = {
      _id: 'webhook-123',
      url: 'http://example.com/hook',
      secret: 'supersecretvalue1234',
      events: ['stream.created'],
      active: true,
    };

    Webhook.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([webhook]),
    });

    const requestSpy = jest.spyOn(http, 'request');
    const timeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn) => {
        fn();
        return 0;
      });

    let attemptCount = 0;
    let capturedPayload = null;
    let capturedHeaders = null;

    requestSpy.mockImplementation((options, responseCb) => {
      attemptCount += 1;
      capturedHeaders = options.headers;

      const req = new EventEmitter();
      req.write = jest.fn((chunk) => {
        capturedPayload = Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
      });
      req.destroy = jest.fn();
      req.end = jest.fn(() => {
        if (attemptCount === 1) {
          req.emit('error', new Error('temporary failure'));
          return;
        }

        const res = new EventEmitter();
        res.statusCode = 204;
        res.resume = jest.fn();
        responseCb(res);
      });
      return req;
    });

    const results = await dispatch('stream.created', {
      streamId: '42',
      txHash: 'tx-123',
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fulfilled');
    expect(attemptCount).toBe(2);
    expect(capturedPayload).toContain('"event":"stream.created"');
    expect(capturedPayload).toContain('"streamId":"42"');
    expect(capturedPayload).toContain('"txHash":"tx-123"');
    expect(capturedHeaders['X-SoroMint-Event']).toBe('stream.created');
    expect(capturedHeaders['X-SoroMint-Webhook-Id']).toBe('webhook-123');
    expect(capturedHeaders['X-SoroMint-Signature']).toBe(
      sign(webhook.secret, capturedPayload)
    );

    timeoutSpy.mockRestore();
    requestSpy.mockRestore();
  });
});
