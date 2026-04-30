import { buildOptions, config, mixedScenarioRequest } from './lib/config.js';

export const options = buildOptions({
  mixed: {
    executor: 'constant-vus',
    vus: config.vus,
    duration: config.duration,
    exec: 'runMixed',
    tags: { scenario: 'mixed' },
  },
});

export function runMixed() {
  mixedScenarioRequest();
}
