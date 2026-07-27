# ADR 0031 — Invoice immutability and numbering

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

Finalize creates a draft projection. A fully paid or zero-total order issues it using a transactional `(tenant, branch, fiscal year)` counter. The number format is `BRANCH-YYYY-000001`; a rolled-back transaction does not consume the counter.

Issued headers and lines are database-protected against update/delete. Receipt rendering reads only issued invoice snapshots, never current branch, customer, service or tax configuration. Delivery requests are separate append-only records and cannot rollback or modify payment/invoice state.

Corrections to an issued document require Sprint 7 credit-note/refund commands.
