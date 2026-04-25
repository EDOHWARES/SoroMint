# Health benchmark summary

- Method: local Node HTTP benchmark with 30 keep-alive clients, 3 measured run(s), 5000ms per run
- Optimized run config: HTTP_LOG_SUCCESS_SAMPLE_RATE=0
- Baseline throughput: 7021.32 req/s
- Optimized throughput: 8337.19 req/s
- Throughput improvement: 18.7%
- Baseline p95 latency: 5.29 ms
- Optimized p95 latency: 4.09 ms
- P95 latency reduction: 22.6%

Primary optimization: skip unsampled 2xx HTTP log object construction/work on the hot path and reuse cached health/streaming service state.
