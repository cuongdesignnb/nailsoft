# Sprint 5 test matrix

| Concern                     |              Unit |    PostgreSQL |       API |          Concurrency |     E2E/mobile |
| --------------------------- | ----------------: | ------------: | --------: | -------------------: | -------------: |
| Walk-in state/order/ETA     |               yes |           yes |       yes |        queue/convert | reception flow |
| Arrival/check-in policy     |               yes |           yes |       yes |            duplicate | scheduled flow |
| Session state/duration      |               yes |           yes |       yes | start/pause/complete |    staff today |
| Staff contribution/transfer |               yes |           yes |       yes |             transfer |  transfer flow |
| Add service                 |          approval |   reservation |       yes |            duplicate |       add flow |
| Notes/media                 | sanitize/validate |     isolation |       yes |             callback |  mobile states |
| Authorization               |            matrix | tenant/branch | own scope |                  n/a |  authenticated |
| Realtime/outbox             |          envelope |    durability | room auth |             ordering |        refetch |

The database suite must run migration up/down/up, preserve Sprint 1-4 data, and assert append-only history and partial unique constraints. Load smoke results are capacity evidence, not production claims.
