# CR-0001: Alignment with Business Master Document v1.0

- Status: Proposed — BA/Product Owner decision required
- Source: `pasted-text.txt`, “Tài liệu nghiệp vụ tổng thể — Nail Salon Management Platform”, version 1.0
- Created: 2026-07-10
- Scope: Requirements reconciliation only; no approved business behavior is changed by this document.

## Context

The business master document is directionally aligned with the current SRS/PRD and confirms the mandatory architecture: multi-tenant and multi-branch SaaS, mobile-first UX, PostgreSQL as system of record, optimistic UI, realtime synchronization, durable idempotency, transactional outbox, auditability and modular-monolith boundaries.

It also introduces requirements or terminology that are absent from, or more detailed than, the current implementation source. Per the project rule against silently changing business behavior, these items require explicit disposition.

## Proposed requirement additions

| ID | Proposed addition | Impact | Suggested backlog placement |
|---|---|---|---|
| CR1-01 | Add `PARTIALLY_COMPLETED` appointment state | Booking state machine, OpenAPI, reporting, cancellation/refund behavior | Decide before Sprint 4 |
| CR1-02 | Add dynamic pricing by staff level, weekday/weekend, peak hour, season, VIP and complexity | Service price model, snapshot rules, permission/audit policy | Decide before Sprint 2 |
| CR1-03 | Add explicit salon/support consent before Platform Super Admin can view sensitive tenant data | Support-access workflow, audit, time-bound authorization | Decide before Sprint 1 |
| CR1-04 | Standardize business event envelope with event ID, tenant, entity, version, actor, timestamp, correlation ID and schema version | Outbox schema and consumer contracts | Approve during foundation hardening, before Sprint 4 |
| CR1-05 | Add Review and Accounting as explicit modules | Module ownership, permissions, database and roadmap | Review in MVP/P1 scope planning |
| CR1-06 | Add gift card creation and commission-period locking to mandatory idempotent commands | Idempotency policy and acceptance tests | Before POS/commission implementation |
| CR1-07 | Add credit note and replacement invoice as paid-invoice adjustment mechanisms | Financial model and audit requirements | Before Sprint 7–8 |
| CR1-08 | Add device and user fields to the offline operation envelope | Shared domain types, local SQLite queue, sync API | Before Sprint 6 |
| CR1-09 | Add observability acceptance measures for WebSocket count, queue backlog, webhook/notification failures, cache hit rate, mobile crashes and abnormal tenant behavior | Telemetry model, dashboards and alerts | Foundation now; production hardening Sprint 12 |
| CR1-10 | Use NestJS Fastify adapter as the preferred HTTP adapter | API bootstrap and compatibility validation | Technical decision; safe before Sprint 1 |

## Clarifications required from BA/Product Owner

1. Is `PARTIALLY_COMPLETED` an appointment state, a derived state from appointment items, or only a reporting label?
2. Which dynamic pricing dimensions are MVP requirements, and what is their precedence when multiple rules match?
3. What grants support access: salon owner approval, break-glass approval, or both? What is the expiry period?
4. Are Review and Accounting separate bounded contexts or capabilities owned by Customer/Reporting/POS?
5. Is “membership” the umbrella term for loyalty and prepaid packages, or a separate paid membership product?
6. Are gift cards required for MVP, and are they treated as stored value with financial liability?
7. Which markets are in the first pilot? This determines currency, tax, timezone and privacy defaults.
8. Which booking statuses may salon administrators configure? Allowing arbitrary states may conflict with a fixed state machine and integrations.

## Confirmed non-conflicting requirements

- PostgreSQL remains authoritative; Redis is not a sole source of truth.
- Booking and financial writes require transactions and durable idempotency.
- Important booking, financial, inventory and permission actions require audit records.
- WebSocket events are synchronization hints; reconnect must refetch missed authoritative state.
- Booking, payment, refund, voucher, package, commission lock and inventory cannot be finally committed offline.
- Policies such as opening hours, deposits, cancellation, commission, tip, tax and permissions must be configurable.
- AI remains post-MVP and may recommend but not autonomously execute financial or bulk-marketing actions.

## Current implementation impact

Sprint 0 remains valid. No existing migration needs destructive alteration. If approved:

- CR1-04 should extend `outbox_events` in a forward-only migration rather than editing production history.
- CR1-08 should extend the shared `LocalOperation` type and validation schema together.
- CR1-10 can change the API adapter before Sprint 1 endpoints are implemented.
- Business-state and pricing decisions must be reflected in acceptance criteria, OpenAPI and tests in their owning sprint.

## Acceptance of this change request

BA/Product Owner should mark each CR1 item as `Accepted`, `Rejected`, `Deferred` or `Needs discovery`. Accepted items must be added to the relevant sprint backlog with acceptance criteria before implementation.
