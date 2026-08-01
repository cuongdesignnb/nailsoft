# Sprint 15 state-transition matrix

| Aggregate | Allowed transitions | Guard |
|---|---|---|
| Vendor | `DRAFT → ACTIVE → ON_HOLD → ACTIVE`, `ACTIVE → INACTIVE → ARCHIVED` | Active vendor currency and tenant scope required |
| Purchase request | `DRAFT → SUBMITTED → APPROVED/PARTIALLY_APPROVED → CONVERTED → CLOSED` | Requester cannot approve; version required |
| Purchase order | `DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACKNOWLEDGED → RECEIVED/BILLED → CLOSED` | Approved economics immutable; amendments create a new version |
| Receipt | `DRAFT → RECEIVED/PARTIALLY_ACCEPTED/ACCEPTED → REVERSED` | Accepted quantity cannot exceed ordered quantity plus tolerance |
| Vendor bill | `DRAFT → SUBMITTED → MATCHING → MATCHED/MATCH_EXCEPTION → PENDING_APPROVAL → APPROVED → POSTING → POSTED` | Normalized invoice uniqueness and 3-way match |
| AP open item | `OPEN → ON_HOLD/DISPUTED → PARTIALLY_PAID → PAID` | Paid + credited + written-off never exceeds original |
| Payment | `DRAFT → PENDING_APPROVAL → APPROVED → PROCESSING → SUCCEEDED/FAILED/UNKNOWN` | Independent approval; unknown requires reconciliation |
| Credit note | `DRAFT → PENDING_APPROVAL → APPROVED → POSTING → POSTED → APPLIED` | Exact bill-line eligibility and cumulative cap |
| Vendor return | `DRAFT → PENDING_APPROVAL → APPROVED → DISPATCHED → RECEIVED_BY_VENDOR → CREDIT_PENDING → COMPLETED` | Returned quantity cannot exceed accepted receipt quantity |

