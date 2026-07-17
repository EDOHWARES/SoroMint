const express = require('express');
const request = require('supertest');
const {
  metricsMiddleware,
  metricsRouter,
  registry,
} = require('../telemetry/metrics');

describe('Prometheus telemetry', () => {
  beforeAll(() => {
    process.env.METRICS_USERNAME = 'prometheus';
    process.env.METRICS_PASSWORD = 'secret';
  });

  afterAll(() => {
    delete process.env.METRICS_USERNAME;
    delete process.env.METRICS_PASSWORD;
  });

  const createApp = () => {
    const app = express();
    app.use(metricsMiddleware);
    app.get('/api/transaction', async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.status(201).json({ ok: true });
    });
    app.use('/metrics', metricsRouter);
    return app;
  };

  it('protects metrics with basic authentication', async () => {
    await request(createApp())
      .get('/metrics')
      .expect(401)
      .expect('WWW-Authenticate', /Basic/);
  });

  it('returns Prometheus exposition and records latency and response codes', async () => {
    const app = createApp();
    await request(app).get('/api/transaction').expect(201);
    const response = await request(app)
      .get('/metrics')
      .auth('prometheus', 'secret')
      .expect(200)
      .expect('Content-Type', registry.contentType);

    expect(response.text).toMatch(
      /^# HELP soromint_http_request_duration_seconds/m
    );
    expect(response.text).toMatch(
      /soromint_http_requests_total\{method="GET",route="\/api\/transaction",status_code="201"\}/
    );
    expect(response.text).toMatch(
      /soromint_http_request_duration_seconds_sum\{method="GET",route="\/api\/transaction",status_code="201"\} 0\.0[2-9]/
    );
  });
});
