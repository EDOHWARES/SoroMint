import { buildOptions, config, healthRequest } from './lib/config.js';

export const options = buildOptions({
  health: {
    executor: 'constant-vus',
    vus: config.vus,
    duration: config.duration,
    exec: 'runHealth',
    tags: { scenario: 'health' },
  },
});

export function runHealth() {
  healthRequest();
}
