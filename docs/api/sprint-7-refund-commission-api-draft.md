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

Closure invariants:

- Refund-window validation runs at plan, create, approval and execution using branch timezone and calendar days. Out-of-window operations require `refund.override_window`, a reason and immutable actor/deadline evidence.
- Cash allocations preserve `originalRegisterId`/`originalCashSessionId`; execution may use a new OPEN session only on that same register. Cross-register requests fail with `CASH_REFUND_REGISTER_MISMATCH` before any movement or credit note.
- External provider name must match the original captured provider. Provider refund references are unique and resolved by `tenant + provider + providerRefundId`; signed webhooks without tenant scope are acknowledged but ignored.
- Refund and credit-note fiscal year is derived in the branch timezone.

## Commission

- Rule read/create/supersede/deactivate under `/commission-rules`.
- Entry branch/own reads under `/commission-entries`, `/staff/:id/commissions`, `/staff/me/commissions`, `/staff/me/tips`.
- Period create/read/review/reopen/lock/statements under `/commission-periods`.
- Adjustment list/create/approve/reject/cancel under `/commission-adjustments`.
- Signed `/payment-providers/{provider}/webhook` accepts opaque refund result events with timestamp and event-ID replay protection; unmatched references are acknowledged without exposing provider payloads.

Commission closure invariants:

- Active rules with the same normalized tenant/branch/staff/service scope, priority and overlapping effective range are rejected as `COMMISSION_RULE_OVERLAP`.
- Manual-adjustment approval atomically inserts exactly one `commission_entries.adjustment_request_id` entry before the request becomes `APPROVED`; no prior invoice/earning is required.
- A locked period accepts only its currency and exact date scope, blocks unresolved conflicts/refund reversals/adjustments, and hashes stable canonical decimal strings without JavaScript `Number` arithmetic.
- A staff statement reads only `tenant + period + staff`; its entry sum is verified against the locked payable snapshot before response.

## Reporting

- `GET /financial/refunds|net-sales|tax-adjustments|tip-summary`
- `GET /financial/commission-liability|commission-by-staff|commission-by-service|credit-notes`
- `POST /financial/exports`, `GET /financial/exports/:id`

Reports accept server-side tenant/branch/date filters. Export jobs store metadata only; downloads must be signed, expiring and CSV-injection sanitized by the worker.
