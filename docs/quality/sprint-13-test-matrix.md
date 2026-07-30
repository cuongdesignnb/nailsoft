# Sprint 13 test matrix

| Risk | Evidence |
|---|---|
| Legacy safety | DISABLED, zero price, active, all projections |
| Proration/immutability | bigint unit boundaries and DB mutation rejection |
| Quota race | concurrent last-slot requests |
| Usage replay | unique source fingerprint and aggregation |
| Invoice/payment | line equality, stable key, UNKNOWN reconcile, refund cap |
| Access/support | direct platform denial, tenant-approved scoped session, hashed token, per-request audit, immediate revoke and expiry |
| Isolation | tenant binding and platform salon-data denial |
| UI/mobile | authenticated Playwright API journey, billing workspaces and Owner smoke |

Renewal coverage runs 20 concurrent workers against one expired subscription and proves one new period, one finalized invoice, exact line reconciliation, scheduled downgrade application, and cancellation-at-period without a second invoice.
