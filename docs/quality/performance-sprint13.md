# Sprint 13 performance evidence

Local targets: entitlement lookup p95 <100ms, usage ingest <250ms, invoice finalize <500ms, quota race <500ms and support authorization <100ms.

Local Docker QA on 2026-07-30 used two concurrent clients, a one-second warmup and a two-second measured window against the deterministic fixture:

| Scenario | Requests | Throughput/s | p95 ms | p99 ms | Error rate |
|---|---:|---:|---:|---:|---:|
| Tenant entitlement projection | 670 | 335.0 | 7.03 | 7.97 | 0% |
| Platform tenant list | 749 | 374.5 | 6.22 | 6.86 | 0% |
| Platform invoice list | 842 | 421.0 | 6.28 | 8.32 | 0% |
| Platform payment list | 881 | 440.5 | 5.45 | 6.46 | 0% |

This is local capacity evidence, not a production-scale claim. Provider-loss, million-event metering and renewal/dunning soak remain mandatory on production-like staging.
