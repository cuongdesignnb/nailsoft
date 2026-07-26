# Sprint 5 state-transition matrix

## Walk-in

| From    | Command                            | To                                  |
| ------- | ---------------------------------- | ----------------------------------- |
| WAITING | ready                              | READY                               |
| WAITING | cancel / mark-left                 | CANCELLED / LEFT                    |
| READY   | call / return / cancel / mark-left | CALLED / WAITING / CANCELLED / LEFT |
| CALLED  | convert / return / mark-left       | CONVERTED / WAITING / LEFT          |

`CONVERTED`, `CANCELLED`, and `LEFT` are terminal. Every command uses optimistic version and append-only history.

## Service session

| From        | Command                           | To                                  |
| ----------- | --------------------------------- | ----------------------------------- |
| PENDING     | start / cancel                    | IN_PROGRESS / CANCELLED             |
| IN_PROGRESS | pause / complete / manager cancel | PAUSED / COMPLETED / CANCELLED      |
| PAUSED      | resume / complete / cancel        | IN_PROGRESS / COMPLETED / CANCELLED |

`COMPLETED` and `CANCELLED` are terminal. Transfer preserves the current session status.

## Appointment derived status

1. Preserve cancelled/expired terminal status.
2. Any `IN_PROGRESS` or `PAUSED` session -> `IN_SERVICE`.
3. All active items completed -> `COMPLETED` and checkout ready.
4. Any completed item -> `PARTIALLY_COMPLETED`.
5. Arrival checked in -> `CHECKED_IN`.
6. Otherwise preserve the booking state.
