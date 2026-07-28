# ADR 0056: Stored-value reservation and redemption

- Status: Accepted for Sprint 10
- The server accepts `min(requested, available, eligible due)`. Eligible due excludes tip and all gift-card funding lines.
- Reserve moves available to reserved; paid checkout moves reserved to redeemed; release/TTL expiry moves reserved back to available.
- Commands lock order, account and reservation rows, require online access and idempotency keys, and use unique active account/order reservations.
- Baseline permits at most one gift-card and one customer-credit application per order. Client-calculated balance or accepted amount is never trusted.
