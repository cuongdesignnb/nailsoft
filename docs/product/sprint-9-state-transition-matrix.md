# Sprint 9 State Transition Matrix

| Aggregate | Allowed transitions |
|---|---|
| Purchase order | DRAFT → SUBMITTED/CANCELLED; SUBMITTED → APPROVED/CANCELLED; APPROVED → PARTIALLY_RECEIVED/RECEIVED/CANCELLED; PARTIALLY_RECEIVED → RECEIVED |
| Receipt | DRAFT → POSTED/CANCELLED; POSTED is immutable |
| Transfer | DRAFT → SHIPPED/CANCELLED; SHIPPED → PARTIALLY_RECEIVED/RECEIVED; PARTIALLY_RECEIVED → RECEIVED |
| Adjustment | PENDING → POSTED/REJECTED/CANCELLED |
| Count | DRAFT → COUNTING/CANCELLED; COUNTING → SUBMITTED/CANCELLED; SUBMITTED → APPROVED/CANCELLED; APPROVED → POSTED |
| Reservation | ACTIVE → COMMITTED/RELEASED/EXPIRED/CANCELLED |
| Return decision | created once per refund item; immutable |

All disallowed transitions return a domain conflict. Concurrent commands serialize on the idempotency scope, aggregate version and stock key.
