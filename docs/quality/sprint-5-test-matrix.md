# Sprint 5 test matrix

| Concern                     |                Unit |                         PostgreSQL |                                              API |                  Concurrency |            E2E/mobile |
| --------------------------- | ------------------: | ---------------------------------: | -----------------------------------------------: | ---------------------------: | --------------------: |
| Walk-in state/order/ETA     |   duration/rounding |                     queue workload |                        real Availability/Planner |       queue/priority/convert |  conversion deep flow |
| Arrival/check-in policy     |                 yes |                                yes |                                              yes |                    duplicate |        scheduled flow |
| Session state/duration      |                 yes |                                yes |                                              yes |         start/pause/complete |           staff today |
| Staff contribution/transfer |                 yes | assignment/reservation consistency |                   current PRIMARY + open segment | transfer/former staff denial |    transfer deep flow |
| Add service                 | approval/time floor |                        reservation |                branch/time/resource revalidation |           duplicate/conflict | add-service deep flow |
| Notes/media                 |   sanitize/validate |             isolation/audit/outbox | current assignment; trusted verification pending |  client cannot promote READY |         mobile states |
| Authorization               |              matrix |                      tenant/branch |               active assignment and branch state |      current execution owner |         authenticated |
| Realtime/outbox             |            envelope |                         durability |                                        room auth |                     ordering |               refetch |
| Timezone/date boundaries    |  HCM + New York DST |                half-open local day |                 board and per-branch Staff Today |                          n/a |    timezone deep flow |

The database suite must run migration up/down/up, preserve Sprint 1-4 data, and assert append-only history and partial unique constraints. Load smoke results are capacity evidence, not production claims.
