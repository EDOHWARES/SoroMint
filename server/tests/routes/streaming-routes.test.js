const request = require('supertest');
const express = require('express');

jest.mock('../../services/streaming-service');
jest.mock('../../services/webhook-service', () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
}));

const StreamingService = require('../../services/streaming-service');
const { dispatch } = require('../../services/webhook-service');
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

  it('emits a stream.created webhook after creating a stream', async () => {
    mockService.createStream.mockResolvedValue({
      hash: 'tx-create',
      streamId: 7,
    });

    const res = await request(app).post('/api/streaming/streams').send({
      sender: 'GSENDER',
      recipient: 'GRECIPIENT',
      tokenAddress: 'CTOKEN',
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
        tokenAddress: 'CTOKEN',
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
