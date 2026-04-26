const request = require('supertest');
const express = require('express');

let mockRole = 'admin';
let mockPublicKey = 'GSOURCEKEYEXAMPLE';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      _id: 'user-1',
      role: mockRole,
      publicKey: mockPublicKey,
    };
    next();
  },
  authorize:
    (...roles) =>
    (req, _res, next) => {
      const { AppError } = require('../../middleware/error-handler');

      if (!req.user) {
        return next(
          new AppError('Authentication required.', 401, 'AUTH_REQUIRED')
        );
      }

      if (!roles.includes(req.user.role)) {
        return next(
          new AppError(
            'Access denied. Insufficient permissions.',
            403,
            'ACCESS_DENIED'
          )
        );
      }

      return next();
    },
}));

jest.mock('../../services/streaming-service');
jest.mock('../../services/webhook-service', () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../models/StreamingTokenWhitelist', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const StreamingService = require('../../services/streaming-service');
const { dispatch } = require('../../services/webhook-service');
const StreamingTokenWhitelist = require('../../models/StreamingTokenWhitelist');
const streamingRoutes = require('../../routes/streaming-routes');
const { errorHandler } = require('../../middleware/error-handler');

describe('streaming routes', () => {
  let app;
  let mockService;

  beforeEach(() => {
    mockService = {
      createStream: jest.fn(),
      withdraw: jest.fn(),
      cancelStream: jest.fn(),
      getStream: jest.fn(),
      getStreamBalance: jest.fn(),
    };

    StreamingService.mockImplementation(() => mockService);
    dispatch.mockClear();
    StreamingTokenWhitelist.find.mockReset();
    StreamingTokenWhitelist.findOne.mockReset();
    StreamingTokenWhitelist.findOneAndUpdate.mockReset();
    mockRole = 'admin';

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.sourceKeypair = {
        publicKey: () => 'GSOURCEKEYEXAMPLE',
      };
      next();
    });
    app.use('/api/streaming', streamingRoutes);
    app.use(errorHandler);
  });

  it('creates a whitelist entry as an admin', async () => {
    StreamingTokenWhitelist.findOneAndUpdate.mockResolvedValue({
      tokenAddress: 'CWHITELISTEDTOKEN',
      tokenName: 'USD Coin',
      tokenSymbol: 'USDC',
      category: 'stablecoin',
      active: true,
    });

    const res = await request(app).post('/api/streaming/whitelist').send({
      tokenAddress: 'CWHITELISTEDTOKEN',
      tokenName: 'USD Coin',
      tokenSymbol: 'USDC',
      category: 'stablecoin',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(StreamingTokenWhitelist.findOneAndUpdate).toHaveBeenCalledWith(
      { tokenAddress: 'CWHITELISTEDTOKEN' },
      expect.objectContaining({
        $set: expect.objectContaining({
          tokenAddress: 'CWHITELISTEDTOKEN',
          tokenName: 'USD Coin',
          tokenSymbol: 'USDC',
          category: 'stablecoin',
          active: true,
        }),
      }),
      expect.objectContaining({
        new: true,
        upsert: true,
        runValidators: true,
      })
    );
  });

  it('lists whitelist entries for an admin', async () => {
    StreamingTokenWhitelist.find.mockResolvedValue([
      {
        tokenAddress: 'CWHITELISTEDTOKEN',
        category: 'stablecoin',
        active: true,
      },
    ]);

    const res = await request(app).get('/api/streaming/whitelist');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tokenAddress).toBe('CWHITELISTEDTOKEN');
  });

  it('rejects non-admin access to whitelist management', async () => {
    mockRole = 'user';

    const res = await request(app).post('/api/streaming/whitelist').send({
      tokenAddress: 'CWHITELISTEDTOKEN',
      tokenName: 'USD Coin',
      tokenSymbol: 'USDC',
      category: 'stablecoin',
    });

    expect(res.status).toBe(403);
  });

  it('deactivates whitelist entries', async () => {
    StreamingTokenWhitelist.findOneAndUpdate.mockResolvedValue({
      tokenAddress: 'CWHITELISTEDTOKEN',
      active: false,
    });

    const res = await request(app).delete(
      '/api/streaming/whitelist/CWHITELISTEDTOKEN'
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(StreamingTokenWhitelist.findOneAndUpdate).toHaveBeenCalledWith(
      { tokenAddress: 'CWHITELISTEDTOKEN' },
      expect.objectContaining({
        $set: expect.objectContaining({
          active: false,
          deactivatedBy: 'GSOURCEKEYEXAMPLE',
        }),
      }),
      expect.objectContaining({
        new: true,
        runValidators: true,
      })
    );
  });

  it('rejects stream creation when the token is not whitelisted', async () => {
    StreamingTokenWhitelist.findOne.mockResolvedValue(null);

    const res = await request(app).post('/api/streaming/streams').send({
      sender: 'GSENDER',
      recipient: 'GRECIPIENT',
      tokenAddress: 'CNOTALLOWED',
      totalAmount: '1000',
      startLedger: 10,
      stopLedger: 20,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_NOT_WHITELISTED');
    expect(mockService.createStream).not.toHaveBeenCalled();
  });

  it('creates a stream and emits webhook for whitelisted tokens', async () => {
    StreamingTokenWhitelist.findOne.mockResolvedValue({
      tokenAddress: 'CWHITELISTEDTOKEN',
      category: 'stablecoin',
      active: true,
    });
    mockService.createStream.mockResolvedValue({
      hash: 'tx-create',
      streamId: 7,
    });

    const res = await request(app).post('/api/streaming/streams').send({
      sender: 'GSENDER',
      recipient: 'GRECIPIENT',
      tokenAddress: 'CWHITELISTEDTOKEN',
      totalAmount: '1000',
      startLedger: 10,
      stopLedger: 20,
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      streamId: 7,
      txHash: 'tx-create',
    });
    expect(dispatch).toHaveBeenCalledWith(
      'stream.created',
      expect.objectContaining({
        streamId: 7,
        txHash: 'tx-create',
        sender: 'GSENDER',
        recipient: 'GRECIPIENT',
        tokenAddress: 'CWHITELISTEDTOKEN',
      })
    );
  });

  it('emits a stream.withdrawn webhook after withdrawing from a stream', async () => {
    mockService.withdraw.mockResolvedValue({
      hash: 'tx-withdraw',
    });

    const res = await request(app)
      .post('/api/streaming/streams/7/withdraw')
      .send({
        amount: '250',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      txHash: 'tx-withdraw',
    });
    expect(dispatch).toHaveBeenCalledWith(
      'stream.withdrawn',
      expect.objectContaining({
        streamId: 7,
        amount: '250',
        txHash: 'tx-withdraw',
      })
    );
  });

  it('emits a stream.canceled webhook after canceling a stream', async () => {
    mockService.cancelStream.mockResolvedValue({
      hash: 'tx-cancel',
    });

    const res = await request(app).delete('/api/streaming/streams/9');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      txHash: 'tx-cancel',
    });
    expect(dispatch).toHaveBeenCalledWith(
      'stream.canceled',
      expect.objectContaining({
        streamId: 9,
        txHash: 'tx-cancel',
      })
    );
  });
});
