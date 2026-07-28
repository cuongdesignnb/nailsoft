# ADR 0056: Stored-value reservation and redemption

- Status: Accepted for Sprint 10
- The server accepts `min(requested, available, remaining eligible due, current order due)`. Eligible due excludes tip and all gift-card funding lines.
- Reserve moves available to reserved; paid checkout moves reserved to redeemed; release/TTL expiry moves reserved back to available.
- Commands lock order, account and reservation rows, require online access and idempotency keys, and use unique active account/order reservations.
- Baseline permits at most one gift-card and one customer-credit application per order. Client-calculated balance or accepted amount is never trusted.

## Closure amendment

External payment evidence is allocated to prohibited/policy-ineligible liabilities first and then eligible lines. Every stored-value reservation persists an exact line plan and immutable eligibility snapshot, which checkout revalidates after each external capture. Invoice issuance copies committed application allocations to immutable invoice-line settlement rows. Refund uses cumulative proportional desired-minus-prior restoration only against the selected invoice line and is capped again by PostgreSQL.
