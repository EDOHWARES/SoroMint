const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../../middleware/error-handler');

describe('Streaming Routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      STREAMING_CONTRACT_ID: 'contract-123',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createAppWithRouter = (router) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.sourceKeypair = { publicKey: () => 'GTEST' };
      next();
    });
    app.use('/api/streaming', router);
    app.use(errorHandler);
    return app;
  };

  it('uses the streaming service factory instead of constructing a new service per request', async () => {
    const service = {
      createStream: jest.fn().mockResolvedValue({ streamId: '77', hash: 'tx-create' }),
      withdraw: jest.fn().mockResolvedValue({ hash: 'tx-withdraw' }),
    };
    const streamingServiceModule = jest.fn();
    streamingServiceModule.getStreamingService = jest.fn(() => service);

    jest.doMock('../../services/streaming-service', () => streamingServiceModule);

    const router = require('../../routes/streaming-routes');
    const app = createAppWithRouter(router);

    const createResponse = await request(app)
      .post('/api/streaming/streams')
      .send({
        sender: 'sender',
        recipient: 'recipient',
        tokenAddress: 'token',
        totalAmount: '1000',
        startLedger: 1,
        stopLedger: 2,
      });

    const withdrawResponse = await request(app)
      .post('/api/streaming/streams/77/withdraw')
      .send({ amount: '50' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual({
      success: true,
      streamId: '77',
      txHash: 'tx-create',
    });
    expect(withdrawResponse.status).toBe(200);
    expect(withdrawResponse.body).toEqual({ success: true, txHash: 'tx-withdraw' });
    expect(streamingServiceModule).not.toHaveBeenCalled();
    expect(streamingServiceModule.getStreamingService).toHaveBeenCalledTimes(2);
    expect(service.createStream).toHaveBeenCalledWith(
      'contract-123',
      expect.any(Object),
      'sender',
      'recipient',
      'token',
      '1000',
      1,
      2
    );
    expect(service.withdraw).toHaveBeenCalledWith(
      'contract-123',
      expect.any(Object),
      '77',
      '50'
    );
  });

  it('preserves get stream and balance responses', async () => {
    const service = {
      getStream: jest
        .fn()
        .mockResolvedValueOnce({ id: '7', recipient: 'recipient' })
        .mockResolvedValueOnce(null),
      getStreamBalance: jest.fn().mockResolvedValue('250'),
    };

    const { createStreamingRouter } = require('../../routes/streaming-routes');
    const app = createAppWithRouter(
      createStreamingRouter({
        getService: () => service,
        getContractId: () => 'contract-123',
      })
    );

    const getResponse = await request(app).get('/api/streaming/streams/7');
    const balanceResponse = await request(app).get('/api/streaming/streams/7/balance');
    const notFoundResponse = await request(app).get('/api/streaming/streams/7');

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual({
      success: true,
      stream: { id: '7', recipient: 'recipient' },
    });
    expect(balanceResponse.status).toBe(200);
    expect(balanceResponse.body).toEqual({ success: true, balance: '250' });
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundResponse.body).toEqual({ error: 'Stream not found' });
  });
});
