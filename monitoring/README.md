# SoroMint monitoring

The Compose stack starts Prometheus on port 9090, Loki on 3100, and Grafana on 3000. Grafana is provisioned with both data sources and the **SoroMint Server Performance** dashboard.

Set `METRICS_USERNAME` and `METRICS_PASSWORD` before production deployment. Prometheus's sample configuration uses `prometheus` / `soromint-metrics`; keep those values synchronized or mount a secret-managed Prometheus configuration. Set `LOKI_HOST` to enable the Winston Loki transport. `LOKI_BASIC_AUTH` is optional and uses the `username:password` format supported by winston-loki.

Start locally with `docker compose up --build`, then verify metrics with:

```sh
curl -u prometheus:soromint-metrics http://localhost:5000/metrics
```

The endpoint exports Node.js process metrics plus request counts and latency, transaction latency, MongoDB pool usage, active Socket.IO connections, and RPC failures. Application integrations can call `observeTransaction` and `recordRpcFailure` from `server/telemetry/metrics.js`.
