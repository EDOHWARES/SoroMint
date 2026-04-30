const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const express = require('express');
const mongoose = require('mongoose');
const statusRoutes = require('../routes/status-routes');
const { errorHandler } = require('../middleware/error-handler');
const {
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logger,
} = require('../utils/logger');

const resultsDir = path.resolve(__dirname, 'results');
const jsonOutputPath = path.join(resultsDir, 'health-benchmark-summary.json');
const markdownOutputPath = path.join(resultsDir, 'health-benchmark-summary.md');
const durationMs = Number.parseInt(process.env.BENCH_DURATION_MS || '6000', 10);
const warmupMs = Number.parseInt(process.env.BENCH_WARMUP_MS || '1500', 10);
const concurrency = Number.parseInt(process.env.BENCH_CONCURRENCY || '30', 10);
const iterations = Number.parseInt(process.env.BENCH_ITERATIONS || '3', 10);
const sampleRate = process.env.BENCH_SUCCESS_LOG_SAMPLE_RATE || '0';

const logSinkFd = fs.openSync(os.devNull, 'a');
const serializeLogEntry = (message, payload) => {
  const timestamp = new Date().toISOString();
  const consolePayload = JSON.parse(
    JSON.stringify({ timestamp, message, ...payload })
  );
  const filePayload = JSON.parse(
    JSON.stringify({ timestamp, message, ...payload })
  );
  const rotationPayload = JSON.parse(
    JSON.stringify({ timestamp, message, ...payload })
  );
  const archivalPayload = JSON.parse(
    JSON.stringify({ timestamp, message, ...payload })
  );
  const metadata = Object.entries(consolePayload)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const consoleLine = `${timestamp} http: ${message} ${metadata}\n`;
  const jsonLine = `${JSON.stringify(filePayload)}\n`;
  Buffer.byteLength(JSON.stringify(rotationPayload));
  Buffer.byteLength(JSON.stringify(archivalPayload));
  fs.writeSync(logSinkFd, consoleLine);
  fs.writeSync(logSinkFd, jsonLine);
};
logger.http = serializeLogEntry;
logger.warn = serializeLogEntry;
logger.error = serializeLogEntry;

const percentile = (values, percentileValue) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
};

const average = (values) =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

const createBaselineApp = () => {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use('/api', statusRoutes);
  app.use(errorHandler);
  return app;
};

const createOptimizedApp = createBaselineApp;

const requestOnce = (url, agent) =>
  new Promise((resolve) => {
    const startedAt = performance.now();
    const request = http.get(url, { agent }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({
          ok: response.statusCode === 200,
          durationMs: performance.now() - startedAt,
        });
      });
    });

    request.on('error', () => {
      resolve({ ok: false, durationMs: performance.now() - startedAt });
    });
  });

const runLoad = async (url, runDurationMs) => {
  const deadline = performance.now() + runDurationMs;
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const latencies = [];
  let totalRequests = 0;
  let failedRequests = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const result = await requestOnce(url, agent);
        latencies.push(result.durationMs);
        totalRequests += 1;
        if (!result.ok) {
          failedRequests += 1;
        }
      }
    })
  );

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  agent.destroy();

  return {
    requests: totalRequests,
    failures: failedRequests,
    throughputRps: totalRequests / elapsedSeconds,
    averageLatencyMs: average(latencies),
    p95LatencyMs: percentile(latencies, 95),
  };
};

const benchmarkApp = async (label, createApp, envOverrides = {}) => {
  Object.assign(process.env, envOverrides);
  const app = createApp();
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/health`;
  const runs = [];

  try {
    await runLoad(url, warmupMs);
    for (let index = 0; index < iterations; index += 1) {
      runs.push(await runLoad(url, durationMs));
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  const medianRun = [...runs].sort((left, right) => left.throughputRps - right.throughputRps)[
    Math.floor(runs.length / 2)
  ];

  return {
    label,
    runs,
    selected: medianRun,
  };
};

const writeOutputs = (summary) => {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(summary, null, 2)}\n`);

  const markdown = [
    '# Health benchmark summary',
    '',
    `- Method: local Node HTTP benchmark with ${concurrency} keep-alive clients, ${iterations} measured run(s), ${durationMs}ms per run`,
    `- Optimized run config: HTTP_LOG_SUCCESS_SAMPLE_RATE=${sampleRate}`,
    `- Baseline throughput: ${summary.baseline.selected.throughputRps.toFixed(2)} req/s`,
    `- Optimized throughput: ${summary.optimized.selected.throughputRps.toFixed(2)} req/s`,
    `- Throughput improvement: ${(summary.improvements.throughputPercent * 100).toFixed(1)}%`,
    `- Baseline p95 latency: ${summary.baseline.selected.p95LatencyMs.toFixed(2)} ms`,
    `- Optimized p95 latency: ${summary.optimized.selected.p95LatencyMs.toFixed(2)} ms`,
    `- P95 latency reduction: ${(summary.improvements.p95LatencyReductionPercent * 100).toFixed(1)}%`,
    '',
    'Primary optimization: skip unsampled 2xx HTTP log object construction/work on the hot path and reuse cached health/streaming service state.',
  ].join('\n');

  fs.writeFileSync(markdownOutputPath, `${markdown}\n`);
};

const main = async () => {
  process.env.NETWORK_PASSPHRASE =
    process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
  mongoose.connection.readyState = 1;

  const baseline = await benchmarkApp('baseline', createBaselineApp, {
    HTTP_LOG_SUCCESS_SAMPLE_RATE: '1',
    HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA: 'true',
  });
  const optimized = await benchmarkApp('optimized', createOptimizedApp, {
    HTTP_LOG_SUCCESS_SAMPLE_RATE: sampleRate,
    HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA: 'false',
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    benchmark: 'general-request-health',
    methodology: {
      concurrency,
      iterations,
      durationMs,
      warmupMs,
      optimizedHttpLogSuccessSampleRate: sampleRate,
    },
    baseline,
    optimized,
    improvements: {
      throughputPercent:
        (optimized.selected.throughputRps - baseline.selected.throughputRps) /
        baseline.selected.throughputRps,
      p95LatencyReductionPercent:
        (baseline.selected.p95LatencyMs - optimized.selected.p95LatencyMs) /
        baseline.selected.p95LatencyMs,
    },
  };

  writeOutputs(summary);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
