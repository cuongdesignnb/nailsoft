# ADR 0041: Loyalty ledger and expiration

Status: Accepted for Sprint 8.

`loyalty_accounts` is the locked balance projection; `loyalty_ledger_entries` is immutable evidence. Earn posts pending points using the paid-order policy snapshot. A leased PostgreSQL job settles them to available points and creates expiry lots. Redemption reserves available balance and allocates FIFO lots. Release and refund post compensating entries. Manual adjustment requires a second actor; a requester cannot approve their own request. Negative balances may be represented after correction but block redemption.
