# Sprint 3 Permission Matrix

| Permission | Owner | Manager | Receptionist | Technician | Accountant | Marketing | Platform admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `availability.read` | ✓ | branch | branch | branch | — | — | — |
| `availability.explain` | ✓ | branch | — | — | — | — | — |
| `calendar.read_branch` | ✓ | branch | branch | — | — | — | — |
| `calendar.read_own` | — | — | — | own | — | — | — |
| `availability_block.read` | ✓ | branch | branch | own | — | — | — |
| `availability_block.create` | ✓ | branch | branch | — | — | — | — |
| `availability_block.update` | ✓ | branch | — | — | — | — | — |
| `availability_block.cancel` | ✓ | branch | branch | — | — | — | — |
| `resource_maintenance.manage` | ✓ | branch | — | — | — | — | — |

“Branch” is enforced from membership claims and PostgreSQL tenant predicates. Technician calendar and block reads are forcibly filtered to the staff profile linked to the membership. Platform Super Admin receives no salon permissions without a future Support Access Grant.
