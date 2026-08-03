# Alert Catalog

| Alert | Threshold | Severity | Action |
|---|---|---|---|
| Readiness failing | 2 consecutive checks | SEV-1 | stop rollout, inspect DB/provider |
| API 5xx | >2% for 5 minutes | SEV-1 | page on-call, preserve request IDs |
| Latency regression | p95 above SLO for 10 minutes | SEV-2 | inspect pool/slow queries |
| Worker stalled | no heartbeat/lease progress for 5 minutes | SEV-1 | recover worker, reconcile leases |
| Backup stale | no successful backup in policy window | SEV-1 | block release and run backup |
| Restore drill failed | any quarterly failure | SEV-1 | freeze go-live, incident review |
