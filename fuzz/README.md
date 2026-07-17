# Contract fuzz targets

Install cargo-fuzz, then run each target from the repository root:

```bash
cargo install cargo-fuzz
cargo fuzz run vault_deposit -- -max_total_time=60
cargo fuzz run stream_release -- -max_total_time=60
```

Both targets exercise the same checked arithmetic used by the contracts.