# ADR 0032 — Cash session reconciliation

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

A drawer has at most one `OPEN`/`CLOSING` session. Business date is derived from branch IANA timezone. Expected cash is always recomputed from append-only movements: opening float + cash sales + cash in − cash out − cash drops. Cash-sale movement records cash applied, not cash received; change never becomes revenue.

Closing requires a declared count. Denominations, when supplied, must exactly match. Variance above the branch threshold needs a separate Manager/Owner actor, explicit approval and reason. Closed sessions cannot reopen.

Daily reconciliation uses branch-local half-open UTC ranges and is operational financial evidence, not a general ledger. Register filtering uses immutable `payments.register_id`, so cash, card, bank transfer and other external evidence follow the same attribution. `cashierUserId` always means the payment capture actor (`payments.created_by_user_id`).

Cash count is blind at the API boundary: the owning Cashier cannot read expected cash or variance while a session is `OPEN` or `CLOSING`, including after declaration. A permissioned Manager/Owner closing-review endpoint exposes expected, declared and variance evidence. A `CLOSED` session reveals final values to its Cashier.
