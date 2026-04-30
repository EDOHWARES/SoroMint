import {
  buildOptions,
  config,
  healthRequest,
  mixedScenarioRequest,
  streamCreateRequest,
  streamWithdrawRequest,
} from './lib/config.js';

export const options = buildOptions({
  health: {
    executor: 'constant-vus',
    vus: config.vus,
    duration: config.duration,
    exec: 'runHealth',
    tags: { scenario: 'health' },
  },
  stream_create: {
    executor: 'constant-vus',
    vus: Math.max(1, Math.floor(config.vus / 2)),
    duration: config.duration,
    exec: 'runStreamCreate',
    startTime: '2s',
    tags: { scenario: 'stream-create' },
  },
  stream_withdraw: {
    executor: 'constant-vus',
    vus: Math.max(1, Math.floor(config.vus / 2)),
    duration: config.duration,
    exec: 'runStreamWithdraw',
    startTime: '4s',
    tags: { scenario: 'stream-withdraw' },
  },
  mixed: {
    executor: 'constant-vus',
    vus: Math.max(1, Math.floor(config.vus / 3)),
    duration: config.duration,
    exec: 'runMixed',
    startTime: '6s',
    tags: { scenario: 'mixed' },
  },
});

export function runHealth() {
  healthRequest();
}

export function runStreamCreate() {
  streamCreateRequest();
}

export function runStreamWithdraw() {
  streamWithdrawRequest();
}

export function runMixed() {
  mixedScenarioRequest();
}
