# ADR 0092 — Procurement and Accounts Payable lifecycle

## Decision

Sprint 15 procurement is a tenant-scoped modular-monolith boundary. Purchase requests, purchase orders, receipts, vendor bills and AP open items use immutable economic snapshots, explicit state transitions, version checks, append-only history, audit and durable outbox evidence. A purchase order is numbered from a locked tenant/branch/year counter; amendments create a new version and never rewrite an approved economic snapshot.

Receipt acceptance is the only operation that increases received quantity and is checked against ordered quantity plus the active tolerance policy. Vendor bills are deduplicated by normalized vendor invoice number and move through a 3-way match (PO, receipt, bill) before approval/posting. Posting creates one AP open item and an accounting posting candidate when Sprint 14 has an active open book/period.

## Consequences

- PostgreSQL remains authoritative; Redis/realtime is only invalidation.
- Every write command carries an idempotency key, tenant/branch scope, version and audit/outbox evidence.
- Existing migrations 0001–0030 remain unchanged; migration 0031 is additive and rollback-safe.
- Provider calls are represented by payment attempt/lease tables and must be processed outside a database transaction by a worker adapter.

