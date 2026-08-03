# Observability Dashboard Catalog

| Dashboard | Signals | Owner | Review |
|---|---|---|---|
| API health | live/ready/startup, 5xx, latency, in-flight | Platform | 24x7 |
| Database | pool saturation, timeout errors, migration head | Platform | 24x7 |
| Worker | startup/shutdown, lease age, failed jobs | Platform | 24x7 |
| Operations | request rate, rate-limit responses, realtime lag | Product operations | business hours |
| Backup/DR | last successful backup, checksum, restore drill | Platform | daily/quarterly |

The API exposes Prometheus text at `/v1/metrics`; labels must not contain tenant/customer PII.
