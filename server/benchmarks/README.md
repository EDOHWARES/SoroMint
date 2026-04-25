# Backend profiling and benchmark workflow

Artifacts live under `server/benchmarks/results/`.

## Prerequisites

- Node.js 24+
- Backend dependencies installed (`npm install` in `server/`)
- `k6` available on `PATH`, or exported via `K6_BIN=/absolute/path/to/k6`

The npm scripts intentionally call the external `k6` binary instead of installing it as a package dependency.

## Node profiling

CPU profile the backend while it serves traffic:

```bash
cd /home/SoroMint/server
PROFILE_EXERCISE_CMD="npm run k6:health" \
HTTP_LOG_SUCCESS_SAMPLE_RATE=0 \
PROFILE_DURATION_MS=15000 \
npm run profile:cpu
```

Heap profile the same path:

```bash
cd /home/SoroMint/server
PROFILE_EXERCISE_CMD="npm run k6:health" \
HTTP_LOG_SUCCESS_SAMPLE_RATE=0 \
PROFILE_DURATION_MS=15000 \
npm run profile:heap
```

`profile-runner.js` starts `index.js`, waits for the configured port, optionally runs `PROFILE_EXERCISE_CMD`, then writes profiler output and metadata to a timestamped directory:

- CPU: `server/benchmarks/results/<timestamp>-cpu/*.cpuprofile`
- Heap: `server/benchmarks/results/<timestamp>-heap/*.heapprofile`
- Metadata: `server/benchmarks/results/<timestamp>-<mode>/metadata.json`

Open `.cpuprofile` files in Chrome DevTools or https://www.speedscope.app/ to inspect flame graphs.

Useful environment variables:

- `PROFILE_SERVER_PORT` or `PORT`: server port to wait on
- `PROFILE_DURATION_MS`: fixed capture duration when no exercise command is supplied
- `PROFILE_EXERCISE_CMD`: shell command to drive traffic during the capture
- `HTTP_LOG_SUCCESS_SAMPLE_RATE`: sample rate for successful 2xx request logging during the run
- `HTTP_LOG_SUCCESS_INCLUDE_CLIENT_METADATA`: set `false` to avoid collecting IP/user-agent on sampled 2xx requests

## K6 load tests

Scripts live in `server/load-tests/`.

Available npm wrappers:

- `npm run k6:all`
- `npm run k6:health`
- `npm run k6:stream:create`
- `npm run k6:stream:withdraw`
- `npm run k6:mixed`

Shared environment variables:

- `BASE_URL`
- `VUS`
- `DURATION`
- `STREAM_ID`
- `SENDER`
- `RECIPIENT`
- `TOKEN_ADDRESS`
- `TOTAL_AMOUNT`
- `START_LEDGER`
- `STOP_LEDGER`
- `WITHDRAW_AMOUNT`

Optional status controls for non-live environments:

- `STREAM_EXPECTED_STATUSES` defaults to `200,201,400,401,404,422,500,503`
- `WITHDRAW_EXPECTED_STATUSES` defaults to `200,400,401,404,422,500,503`

`GET /api/health` is the strict availability scenario. The blockchain-backed scenarios still report latency and throughput even when a local or non-funded environment returns expected non-2xx responses.

Each script tags requests with a `scenario` label and applies thresholds for:

- p95 latency
- error rate
- throughput (`http_reqs` rate)

Example health-only run:

```bash
cd /home/SoroMint/server
BASE_URL=http://127.0.0.1:5000 \
VUS=30 \
DURATION=30s \
K6_BIN=k6 \
npm run k6:health
```

Example mixed run against a local environment with tolerated non-2xx stream responses:

```bash
cd /home/SoroMint/server
BASE_URL=http://127.0.0.1:5000 \
STREAM_EXPECTED_STATUSES=201,400,401,422,500 \
WITHDRAW_EXPECTED_STATUSES=200,400,401,404,422,500 \
npm run k6:mixed
```

## Baseline vs optimized comparison

A fast local acceptance benchmark is included for the hot `GET /api/health` path:

```bash
cd /home/SoroMint/server
BENCH_CONCURRENCY=30 \
BENCH_ITERATIONS=3 \
BENCH_DURATION_MS=6000 \
BENCH_SUCCESS_LOG_SAMPLE_RATE=0 \
npm run benchmark:health
```

This writes:

- `server/benchmarks/results/health-benchmark-summary.json`
- `server/benchmarks/results/health-benchmark-summary.md`

Methodology:

1. Run a baseline app with the optimized route code but `HTTP_LOG_SUCCESS_SAMPLE_RATE=1` and client metadata enabled for every 2xx response.
2. Run the optimized app with sampled 2xx logging (`HTTP_LOG_SUCCESS_SAMPLE_RATE=0`) and client metadata disabled for unsampled successes.
3. Drive both with the same keep-alive HTTP client pool and compare selected median runs.

This isolates the per-request logging hot path while still exercising the real `GET /api/health` response shape. Use the benchmark summary together with the K6 runs for regression tracking. Regenerate the checked-in summary whenever the health or logging hot path changes.
