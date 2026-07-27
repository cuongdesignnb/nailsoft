# Sprint 6 state-transition matrix

## POS order

| From              | Command                      | To                                       |
| ----------------- | ---------------------------- | ---------------------------------------- |
| DRAFT             | finalize                     | READY_FOR_PAYMENT or PAID for zero total |
| DRAFT             | void/expire                  | VOIDED/EXPIRED                           |
| READY_FOR_PAYMENT | capture partial/full payment | PARTIALLY_PAID/PAID                      |
| READY_FOR_PAYMENT | void before payment          | VOIDED                                   |
| PARTIALLY_PAID    | capture remaining payment    | PAID                                     |

`PAID`, `VOIDED`, and `EXPIRED` are terminal in Sprint 6. First capture locks all pricing/tax/discount/tip snapshots.

## Payment and invoice

Recorded cash/manual-external evidence enters `CAPTURED`. Failed/authorized provider states are foundations for a real adapter. An invoice progresses `DRAFT → ISSUED`, or `DRAFT → VOIDED_BEFORE_PAYMENT`; `ISSUED` is database immutable.

## Cash session

| From    | Command                 | To        |
| ------- | ----------------------- | --------- |
| OPEN    | begin closing           | CLOSING   |
| OPEN    | cancel with no activity | CANCELLED |
| CLOSING | manager reopen          | OPEN      |
| CLOSING | declare then close      | CLOSED    |

`CLOSED` cannot reopen. High variance requires dual control.
