# Sprint 7 financial API contract

All routes are under `/v1`, require bearer authentication and tenant context, and return the standard `{success,data,meta}` envelope. Financial commands require `Idempotency-Key`; same key with a different request returns `IDEMPOTENCY_KEY_REUSED`.

## Refunds and credit notes

- `POST /invoices/:invoiceId/refund-plans`
- `POST /invoices/:invoiceId/refunds`
- `GET /refunds`, `GET /refunds/:id`, `/history`, `/attempts`
- `POST /refunds/:id/submit|approve|reject|cancel|execute-cash|execute-external|retry`
- `GET /credit-notes`, `GET /credit-notes/:id`, `GET /credit-notes/:id/print`
- `POST /credit-notes/:id/deliver`

The plan response is authoritative for service/tax/tip components, original-tender allocations, balance and approval requirement. Execution responses include the immutable credit-note reference after completion.

## Commission

- Rule read/create/supersede/deactivate under `/commission-rules`.
- Entry branch/own reads under `/commission-entries`, `/staff/:id/commissions`, `/staff/me/commissions`, `/staff/me/tips`.
- Period create/read/review/reopen/lock/statements under `/commission-periods`.
- Adjustment list/create/approve/reject/cancel under `/commission-adjustments`.
- Signed `/payment-providers/{provider}/webhook` accepts opaque refund result events with timestamp and event-ID replay protection; unmatched references are acknowledged without exposing provider payloads.

## Reporting

- `GET /financial/refunds|net-sales|tax-adjustments|tip-summary`
- `GET /financial/commission-liability|commission-by-staff|commission-by-service|credit-notes`
- `POST /financial/exports`, `GET /financial/exports/:id`

Reports accept server-side tenant/branch/date filters. Export jobs store metadata only; downloads must be signed, expiring and CSV-injection sanitized by the worker.
