import { buildOptions, config, streamWithdrawRequest } from './lib/config.js';

export const options = buildOptions({
  stream_withdraw: {
    executor: 'constant-vus',
    vus: config.vus,
    duration: config.duration,
    exec: 'runStreamWithdraw',
    tags: { scenario: 'stream-withdraw' },
  },
});

export function runStreamWithdraw() {
  streamWithdrawRequest();
}
