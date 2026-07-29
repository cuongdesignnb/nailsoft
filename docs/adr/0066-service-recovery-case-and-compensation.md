# ADR 0066 — Service Recovery Case and Compensation

Status: Accepted for Sprint 11.

## Decision

Recovery is a branch-scoped aggregate with state history, timezone-captured SLA deadlines, assignments, tasks and privacy-safe contact records. Status commands are explicit and optimistic-versioned.

Compensation is dual-control. Approval calls existing Customer Credit, Loyalty or Voucher services with their idempotency, audit and ledger rules; Recovery never updates money, points or voucher balances directly. A case cannot resolve while compensation is unposted.

## Consequences

Commission, benefit and stored-value ledgers retain ownership. Recovery records only the returned domain reference.
