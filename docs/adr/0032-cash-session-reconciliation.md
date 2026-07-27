# ADR 0032 — Cash session reconciliation

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

A drawer has at most one `OPEN`/`CLOSING` session. Business date is derived from branch IANA timezone. Expected cash is always recomputed from append-only movements: opening float + cash sales + cash in − cash out − cash drops. Cash-sale movement records cash applied, not cash received; change never becomes revenue.

Closing requires a declared count. Denominations, when supplied, must exactly match. Variance above the branch threshold needs a separate Manager/Owner actor, explicit approval and reason. Closed sessions cannot reopen.

Daily reconciliation uses branch-local half-open UTC ranges and is operational financial evidence, not a general ledger.
