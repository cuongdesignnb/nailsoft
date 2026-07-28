# ADR 0055: Gift-card issuance and activation

- Status: Accepted for Sprint 10
- A POS gift-card line creates a `PENDING_ACTIVATION` card, a pending ledger entry, and display-once credentials.
- Gift-card lines are non-taxable, non-discountable, earn no loyalty, and are classified as liability funding rather than revenue.
- Activation occurs only in the payment capture transaction after the whole order becomes `PAID`; void/remove appends cancellation and never deletes history.
- Concurrent capture is serialized by existing POS/idempotency locks and the activation generation key. A failed funding payment cannot activate value.
