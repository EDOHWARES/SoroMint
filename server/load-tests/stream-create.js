import { buildOptions, config, streamCreateRequest } from './lib/config.js';

export const options = buildOptions({
  stream_create: {
    executor: 'constant-vus',
    vus: config.vus,
    duration: config.duration,
    exec: 'runStreamCreate',
    tags: { scenario: 'stream-create' },
  },
});

export function runStreamCreate() {
  streamCreateRequest();
}
