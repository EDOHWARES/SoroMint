import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const parseIntEnv = (name, fallback) => {
  const value = __ENV[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseCsvEnv = (name, fallback) => {
  const value = __ENV[name];
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number.parseInt(entry, 10))
    .filter(Number.isFinite);
};

export const config = {
  baseUrl: __ENV.BASE_URL || 'http://127.0.0.1:5000',
  vus: parseIntEnv('VUS', 20),
  duration: __ENV.DURATION || '30s',
  streamId: __ENV.STREAM_ID || '1',
  sender: __ENV.SENDER || '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  recipient:
    __ENV.RECIPIENT ||
    'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
  tokenAddress:
    __ENV.TOKEN_ADDRESS || '1111111111111111111111111111111111111111111111111111111111111111',
  totalAmount: __ENV.TOTAL_AMOUNT || '1000000',
  startLedger: parseIntEnv('START_LEDGER', 100),
  stopLedger: parseIntEnv('STOP_LEDGER', 200),
  withdrawAmount: __ENV.WITHDRAW_AMOUNT || '1000',
  acceptableStreamStatuses: parseCsvEnv(
    'STREAM_EXPECTED_STATUSES',
    [200, 201, 400, 401, 404, 422, 500, 503]
  ),
  acceptableWithdrawStatuses: parseCsvEnv(
    'WITHDRAW_EXPECTED_STATUSES',
    [200, 400, 401, 404, 422, 500, 503]
  ),
};

export const scenarioLatency = new Trend('scenario_latency_ms', true);
export const scenarioErrors = new Rate('scenario_error_rate');
export const scenarioRequests = new Counter('scenario_requests');

export const defaultThresholds = {
  'http_req_failed{scenario:health}': ['rate<0.01'],
  'http_req_duration{scenario:health}': ['p(95)<200'],
  'http_reqs{scenario:health}': ['rate>50'],
  'scenario_error_rate{scenario:health}': ['rate<0.01'],
  'scenario_latency_ms{scenario:health}': ['p(95)<200'],
  'http_req_duration{scenario:stream-create}': ['p(95)<2000'],
  'http_req_duration{scenario:stream-withdraw}': ['p(95)<2000'],
  'http_req_duration{scenario:mixed}': ['p(95)<1500'],
  'scenario_error_rate{scenario:stream-create}': ['rate<1'],
  'scenario_error_rate{scenario:stream-withdraw}': ['rate<1'],
  'scenario_error_rate{scenario:mixed}': ['rate<1'],
};

export const buildOptions = (scenarios) => ({
  scenarios,
  thresholds: defaultThresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
});

const recordMetrics = (tags, response, success) => {
  scenarioRequests.add(1, tags);
  scenarioLatency.add(response.timings.duration, tags);
  scenarioErrors.add(success ? 0 : 1, tags);
};

export const healthRequest = (tags = { scenario: 'health' }) => {
  const response = http.get(`${config.baseUrl}/api/health`, { tags });
  const success = check(response, {
    [`${tags.scenario} returns 200`]: (res) => res.status === 200,
  });

  recordMetrics(tags, response, success);
  return response;
};

export const streamCreateRequest = (tags = { scenario: 'stream-create' }) => {
  const payload = JSON.stringify({
    sender: config.sender,
    recipient: config.recipient,
    tokenAddress: config.tokenAddress,
    totalAmount: config.totalAmount,
    startLedger: config.startLedger,
    stopLedger: config.stopLedger,
  });
  const response = http.post(`${config.baseUrl}/api/streaming/streams`, payload, {
    tags,
    headers: { 'Content-Type': 'application/json' },
  });
  const success = check(response, {
    [`${tags.scenario} stream create returns expected status`]: (res) =>
      config.acceptableStreamStatuses.includes(res.status),
  });

  recordMetrics(tags, response, success);
  return response;
};

export const streamBalanceRequest = (tags = { scenario: 'mixed', step: 'stream-balance' }) => {
  const response = http.get(
    `${config.baseUrl}/api/streaming/streams/${config.streamId}/balance`,
    {
      tags,
    }
  );
  const success = check(response, {
    [`${tags.scenario} stream balance returns expected status`]: (res) =>
      [200, 400, 401, 404, 422, 500, 503].includes(res.status),
  });

  recordMetrics(tags, response, success);
  return response;
};

export const streamWithdrawRequest = (tags = { scenario: 'stream-withdraw' }) => {
  const payload = JSON.stringify({ amount: config.withdrawAmount });
  const response = http.post(
    `${config.baseUrl}/api/streaming/streams/${config.streamId}/withdraw`,
    payload,
    {
      tags,
      headers: { 'Content-Type': 'application/json' },
    }
  );
  const success = check(response, {
    [`${tags.scenario} stream withdraw returns expected status`]: (res) =>
      config.acceptableWithdrawStatuses.includes(res.status),
  });

  recordMetrics(tags, response, success);
  return response;
};

export const mixedScenarioRequest = () => {
  const health = healthRequest({ scenario: 'mixed', step: 'health' });
  const create = streamCreateRequest({ scenario: 'mixed', step: 'stream-create' });
  const balance = streamBalanceRequest({ scenario: 'mixed', step: 'stream-balance' });
  const withdraw = streamWithdrawRequest({
    scenario: 'mixed',
    step: 'stream-withdraw',
  });
  const success =
    health.status === 200 &&
    config.acceptableStreamStatuses.includes(create.status) &&
    config.acceptableWithdrawStatuses.includes(withdraw.status) &&
    [200, 400, 401, 404, 422, 500, 503].includes(balance.status);

  check({ health, create, balance, withdraw }, {
    'mixed scenario responses stay inside allowed ranges': () => success,
  });

  return { health, create, balance, withdraw };
};
