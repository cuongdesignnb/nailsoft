# Sprint 3 Permission Matrix

| Permission / realtime scope | Owner | Manager | Receptionist | Technician | Accountant | Marketing | Platform admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `availability.read` | tenant | branch | branch | branch | — | — | — |
| `availability.explain` | tenant | branch | — | — | — | — | — |
| `calendar.read_branch` | tenant | branch | branch | — | — | — | — |
| `calendar.read_own` | — | — | — | own | — | — | — |
| `availability_block.read` | tenant | branch | branch | own | — | — | — |
| `availability_block.create` | tenant | branch | branch | — | — | — | — |
| `availability_block.update` | tenant | branch | — | — | — | — | — |
| `availability_block.cancel` | tenant | branch | branch | — | — | — | — |
| `resource_maintenance.manage` | tenant | branch | — | — | — | — | — |
| Realtime tenant room | yes | — | — | — | — | — | denied |
| Realtime branch room | active tenant branches | assigned active | assigned active | — | — | — | denied |
| Realtime staff room | optional through broader role | optional through broader role | — | linked own only | — | — | denied |

“Branch” is reloaded from `membership_branches` for every HTTP request and WebSocket connection, then limited to active branches for scheduling rooms. Technician scope is resolved from `staff_profiles(tenant_id, membership_id)`; a handshake `staffId` is ignored. Platform Super Admin receives no salon permission or scheduling room without a future Support Access Grant.
