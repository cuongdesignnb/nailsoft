# Sprint 8 state-transition matrix

| Aggregate | Allowed transitions |
| --- | --- |
| Voucher campaign | DRAFT -> ACTIVE; ACTIVE -> PAUSED/ENDED; PAUSED -> ACTIVE/ENDED |
| Voucher code | AVAILABLE -> RESERVED -> USED/PARTIALLY_USED; RESERVED -> AVAILABLE on release; active -> EXPIRED/CANCELLED |
| Benefit reservation | ACTIVE -> COMMITTED/RELEASED/EXPIRED/CANCELLED |
| Loyalty adjustment | PENDING -> APPROVED/REJECTED/CANCELLED; approval actor differs from requester |
| Membership assignment | PENDING -> ACTIVE; ACTIVE -> EXPIRED/REVOKED/SUPERSEDED |
| Package entitlement | ACTIVE -> EXHAUSTED/EXPIRED/CANCELLED; reversal may restore ACTIVE |
| Export/job | PENDING -> PROCESSING/READY or FAILED with leased retry |

Terminal histories are never reopened by mutation; corrections append compensating evidence.
