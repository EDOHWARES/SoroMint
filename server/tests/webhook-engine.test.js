const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');
const express = require('express');
const Webhook = require('../models/Webhook');
const WebhookDelivery = require('../models/WebhookDelivery');
const { dispatch } = require('../services/webhook-service');
const { webhookQueue, worker } = require('../services/webhook-queue');

let mongoServer;
let mockServer;
let mockServerPort;
let webhookUrl;
let requestCount = 0;
let shouldFail = true;

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    })),
    Worker: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
    })),
  };
});

describe('Webhook Engine', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Setup local mock server
    const app = express();
    app.post('/webhook', (req, res) => {
      requestCount++;
      if (shouldFail) {
        res.status(500).send('Internal Server Error');
      } else {
        res.status(200).send('OK');
      }
    });

    await new Promise((resolve) => {
      mockServer = app.listen(0, () => {
        mockServerPort = mockServer.address().port;
        webhookUrl = `http://localhost:${mockServerPort}/webhook`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
    await new Promise(resolve => mockServer.close(resolve));
  });

  beforeEach(async () => {
    await Webhook.deleteMany({});
    await WebhookDelivery.deleteMany({});
    requestCount = 0;
    shouldFail = true;
  });

  it('should create WebhookDelivery and add job to queue on dispatch', async () => {
    const webhook = await Webhook.create({
      ownerPublicKey: 'GABC123',
      url: webhookUrl,
      secret: 'super-secret-16-chars',
      events: ['token.minted'],
      active: true,
    });

    const event = 'token.minted';
    const data = { tokenId: '123' };

    const results = await dispatch(event, data);
    
    expect(results).toBeDefined();
    expect(results.length).toBe(1);

    const delivery = await WebhookDelivery.findOne({ webhookId: webhook._id });
    expect(delivery).toBeDefined();
    expect(delivery.status).toBe('PENDING');
    expect(delivery.event).toBe(event);
    expect(delivery.data).toEqual(data);
  });

  it('worker should process delivery successfully', async () => {
    const webhook = await Webhook.create({
      ownerPublicKey: 'GABC123',
      url: webhookUrl,
      secret: 'super-secret-16-chars',
      events: ['token.minted'],
      active: true,
    });

    const delivery = await WebhookDelivery.create({
      webhookId: webhook._id,
      event: 'token.minted',
      data: { tokenId: '456' },
      status: 'PENDING',
      attempts: 0,
    });

    shouldFail = false; // Server responds OK

    const { processWebhookDelivery } = require('../services/webhook-queue');
    const job = { data: { deliveryId: delivery._id }, attemptsMade: 0 };

    await processWebhookDelivery(job);

    const updatedDelivery = await WebhookDelivery.findById(delivery._id);
    expect(updatedDelivery.status).toBe('SUCCESS');
    expect(updatedDelivery.attempts).toBe(1);
    expect(requestCount).toBe(1);
  });

  it('worker should mark as FAILED and throw on request error', async () => {
    const webhook = await Webhook.create({
      ownerPublicKey: 'GABC123',
      url: webhookUrl,
      secret: 'super-secret-16-chars',
      events: ['token.minted'],
      active: true,
    });

    const delivery = await WebhookDelivery.create({
      webhookId: webhook._id,
      event: 'token.minted',
      data: { tokenId: '789' },
      status: 'PENDING',
      attempts: 0,
    });

    shouldFail = true; // Server responds 500

    const { processWebhookDelivery } = require('../services/webhook-queue');
    const job = { data: { deliveryId: delivery._id }, attemptsMade: 0 };

    await expect(processWebhookDelivery(job)).rejects.toThrow('HTTP 500');

    const updatedDelivery = await WebhookDelivery.findById(delivery._id);
    expect(updatedDelivery.status).toBe('FAILED');
    expect(updatedDelivery.attempts).toBe(1);
    expect(updatedDelivery.errorLogs.length).toBe(1);
    expect(requestCount).toBe(1);
  });
});
