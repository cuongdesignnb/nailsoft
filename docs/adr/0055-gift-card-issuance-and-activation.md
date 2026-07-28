# ADR 0055: Gift-card issuance and activation

- Status: Accepted for Sprint 10
- A POS gift-card line creates a `PENDING_ACTIVATION` card, a pending ledger entry, and display-once credentials.
- Gift-card lines are non-taxable, non-discountable, earn no loyalty, and are classified as liability funding rather than revenue.
- Activation occurs only in the payment capture transaction after the whole order becomes `PAID`; void/remove appends cancellation and never deletes history.
- Concurrent capture is serialized by existing POS/idempotency locks and the activation generation key. A failed funding payment cannot activate value.

## Closure amendment

Activation no longer attributes every card to the final payment. Captured `ORDER_TOTAL` allocations are consumed deterministically across Gift Card funding lines, persisted in immutable `stored_value_funding_allocations`, and must sum to each card's face value before liability posting. Reload uses the same evidence but requires a dedicated single-line reload order. PostgreSQL caps payment and line allocation so concurrent or cross-purpose payment reuse fails closed.
