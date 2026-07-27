# Sprint 7 state-transition matrix

## Refund

| From                         | Command               | To                       | Key guards                              |
| ---------------------------- | --------------------- | ------------------------ | --------------------------------------- |
| DRAFT                        | submit                | PENDING_APPROVAL         | current version, refundable balances    |
| DRAFT                        | approve               | APPROVED                 | permission, limit, dual control         |
| DRAFT/PENDING_APPROVAL       | cancel                | CANCELLED                | reason, current version                 |
| PENDING_APPROVAL             | approve/reject        | APPROVED/REJECTED        | permission, limit, requester separation |
| APPROVED                     | execute-cash/external | PROCESSING or COMPLETED  | original tender, confirmed movement     |
| PROCESSING                   | provider result       | COMPLETED/FAILED/UNKNOWN | safe provider evidence                  |
| FAILED/UNKNOWN               | retry                 | PROCESSING               | same aggregate and provider key         |
| COMPLETED/REJECTED/CANCELLED | any command           | —                        | terminal                                |

`COMPLETED` requires all allocations completed and component totals equal the completed amount.

## Credit note

| From   | Command       | To     | Guard                                           |
| ------ | ------------- | ------ | ----------------------------------------------- |
| DRAFT  | issue         | ISSUED | refund COMPLETED, unique refund, locked counter |
| ISSUED | update/delete | —      | database trigger denies                         |

## Commission period

| From   | Command       | To     | Guard                                          |
| ------ | ------------- | ------ | ---------------------------------------------- |
| OPEN   | start-review  | REVIEW | current version                                |
| REVIEW | reopen-review | OPEN   | reason and current version                     |
| REVIEW | lock          | LOCKED | no unresolved conflicts, atomic snapshots/hash |
| LOCKED | any mutation  | —      | terminal; adjustment posts later               |

## Adjustment request

`PENDING → APPROVED | REJECTED | CANCELLED`. Requester cannot approve their own request. Approval creates exactly one append-only `MANUAL_ADJUSTMENT` entry.
