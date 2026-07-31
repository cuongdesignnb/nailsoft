# Accounting event catalog

| Event | Aggregate | Meaning |
|---|---|---|
| `accounting.journal.created` | journal | Draft journal created |
| `accounting.journal.approved` | journal | Independent approval recorded |
| `accounting.journal.posted` | journal | Balanced immutable journal posted |
| `accounting.period.closed` | period | Close approval completed |
| `accounting.opening_balance.posted` | opening balance | Cutover journal posted |
| `accounting.bank.reconciled` | reconciliation | Reconciliation closed |
| `accounting.journal.reversal_requested` | journal | Reversal approval requested |
| `accounting.journal.reversal_created` | journal | Compensating journal created |
| `accounting.journal.reversed` | journal | Original journal reversed after compensating post |
| `accounting.period.pending_close` | period | Close requested with checklist evidence |
| `accounting.period.reopened` | period | Dual-control reopen completed |

Payloads contain identifiers and fingerprints only; PostgreSQL remains the source of truth.
