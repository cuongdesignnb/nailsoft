# Sprint 14 state transitions

| Aggregate | Allowed transitions |
|---|---|
| Journal | DRAFT → PENDING_APPROVAL → APPROVED → POSTED; POSTED → REVERSED only through posted reversal |
| Period | FUTURE → OPEN → SOFT_CLOSED → PENDING_CLOSE → CLOSED; CLOSED → REOPEN_PENDING → REOPENED |
| Opening balance | DRAFT → VALIDATED → PENDING_APPROVAL → APPROVED → POSTED |
| Reconciliation | DRAFT → MATCHING → REVIEW → RECONCILED → CLOSED; void is independently approved |

Terminal/posted states are immutable and every approval records the authenticated actor.
