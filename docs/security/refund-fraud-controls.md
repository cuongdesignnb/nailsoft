# Sprint 7 refund fraud controls

- Server-derived captured, invoice-line, tip and payment refundable balances; no client-authoritative totals.
- Row locks plus completed-balance revalidation at execution.
- Original-tender-only baseline and unique provider refund references.
- Dual control, role amount limits, refund window and mandatory reason evidence.
- Cash payout requires own/manager cash session, active server-resolved device binding and non-negative expected cash.
- Provider timeout maps to `UNKNOWN`; retry queries the same aggregate using the same derived provider key.
- Full PAN, CVV, secrets, raw provider payloads and customer PII are excluded from logs/outbox.
- Export authorization applies server-side tenant/branch filters; files require signed expiry and spreadsheet-formula escaping.
- Rate limiting for approval/execution/provider-result routes remains a production gateway control and is tracked as technical debt until deployment configuration is available.
