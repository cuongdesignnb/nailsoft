# Sprint 4 state transition matrix

## Appointment

| Current                | Command         | Next                     | Required conditions                                      |
| ---------------------- | --------------- | ------------------------ | -------------------------------------------------------- |
| `DRAFT`                | create/finalize | `PENDING_CONFIRMATION`   | manual-confirm policy                                    |
| `DRAFT`                | create/finalize | `PENDING_DEPOSIT`        | deposit required and not waived                          |
| `DRAFT`                | create/finalize | `CONFIRMED`              | auto-confirm and no pending deposit                      |
| `DRAFT`                | expire          | `EXPIRED`                | expiry reached                                           |
| `DRAFT`                | cancel          | customer/salon cancelled | authorized actor and reason                              |
| `PENDING_CONFIRMATION` | confirm         | `CONFIRMED`              | permission and valid reservations                        |
| `PENDING_CONFIRMATION` | require deposit | `PENDING_DEPOSIT`        | policy snapshot requires deposit                         |
| `PENDING_CONFIRMATION` | expire          | `EXPIRED`                | confirmation deadline reached                            |
| `PENDING_CONFIRMATION` | cancel          | customer/salon cancelled | authorized actor and reason                              |
| `PENDING_DEPOSIT`      | waive deposit   | `CONFIRMED`              | waiver permission and reason                             |
| `PENDING_DEPOSIT`      | confirm         | `CONFIRMED`              | future payment event or valid waiver                     |
| `PENDING_DEPOSIT`      | expire          | `EXPIRED`                | deposit deadline reached                                 |
| `PENDING_DEPOSIT`      | cancel          | customer/salon cancelled | authorized actor and reason                              |
| `CONFIRMED`            | reschedule      | `CONFIRMED`              | replacement hold, same branch/services, matching version |
| `CONFIRMED`            | cancel          | customer/salon cancelled | authorized actor and reason                              |

All other transitions return a domain conflict. Sprint 4 exposes no command for check-in, execution, completion or no-show.

## Slot hold

| Current  | Command | Next       |
| -------- | ------- | ---------- |
| `ACTIVE` | consume | `CONSUMED` |
| `ACTIVE` | release | `RELEASED` |
| `ACTIVE` | expire  | `EXPIRED`  |

Terminal hold states are immutable. Identical idempotent commands replay the original response.
