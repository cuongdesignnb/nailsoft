# Gift-card fraud controls

- Tenant-keyed HMAC card identity and salted scrypt PIN; plaintext display once.
- Generic invalid response, per-user/card lookup windows, failed-PIN lockout and gateway rate-limit requirement.
- Online-only issue/reload/reserve/redeem/refund; idempotency and row locks protect retries and races.
- Funding payment must be captured, currency-matched and unique to activation/reload.
- Non-discountable/non-taxable funding lines; stored value cannot cover tip, gift-card lines or cash-out.
- Dual control for credit adjustments and legal approval; high-value gateway approval remains production configuration.
- Audit/outbox exclude number, PIN, contact and policy notes. Reconciliation exceptions alert without self-repair.
