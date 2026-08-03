# Service Level Objectives

| Service | SLO | Measurement |
|---|---:|---|
| API availability | 99.9% monthly | successful non-5xx requests |
| API readiness | 99.95% during staffed hours | readiness probe |
| API latency | p95 < 700ms for operational reads | request metrics |
| Realtime signal | p95 < 1s | client/server timestamps |
| RPO | <= 15 minutes | backup timestamps |
| RTO | <= 60 minutes | restore drill |

These are targets until staging evidence is attached; they are not a production availability claim.
