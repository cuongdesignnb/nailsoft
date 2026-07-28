# Gift-card fraud controls

- Tenant-keyed HMAC card identity and salted scrypt PIN; plaintext display once.
- Generic invalid response, per-user/card lookup windows, failed-PIN lockout and gateway rate-limit requirement.
- Online-only issue/reload/reserve/redeem/refund; idempotency and row locks protect retries and races.
- Funding payment must be captured, currency/branch/order-line matched, have remaining `ORDER_TOTAL` allocation and be immutable after exact activation/reload allocation.
- Non-discountable/non-taxable funding lines; stored value cannot cover tip, gift-card lines or cash-out.
- Persisted branch-local daily issue/redeem/reload counters cover actor, device, customer and account dimensions under transaction locking.
- High-value issue/redeem/reload requires Owner/Manager reason and immutable approval evidence.
- Reserve consumes the same persisted lookup limiter as lookup and enforces a recent-reservation attempt cap; invalid responses never disclose card/customer existence.
- Dual control remains mandatory for credit adjustments and legal approval.
- Audit/outbox exclude number, PIN, contact and policy notes. Reconciliation exceptions alert without self-repair.
