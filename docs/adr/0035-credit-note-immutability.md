# ADR 0035 — Credit note immutability and numbering

- Status: Accepted for Sprint 7
- Date: 2026-07-27

## Decision

A completed refund atomically issues one credit note. Numbering uses a locked `(tenant, branch, fiscal year)` counter and the format `CN-BRANCH-YYYY-000001`. The note snapshots customer, branch, original invoice, line, tax and tip correction evidence. Database triggers reject update/delete of an issued note or its lines.

The original invoice remains `ISSUED`. `PARTIALLY_REFUNDED` and `REFUNDED` are derived from completed refund balances and are never persisted over the original invoice status. Correction of an issued credit note requires a future correcting document, not mutation.

## Consequences

Concurrent completion cannot issue duplicate numbers or duplicate notes. Print/delivery reads the immutable document and creates audit/outbox evidence without changing it.
