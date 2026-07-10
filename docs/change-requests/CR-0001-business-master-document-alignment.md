# CR-0001: Business Master Document Alignment

- Decision: Approved with Conditions
- Decision date: 2026-07-10
- Status: Closed
- Source: Business Master Document v1.0
- Implementation source: the reconciled SRS/PRD
- Sprint 0 impact: no destructive migration and no scope expansion

## Governing conditions

Approved requirements enter their owning sprint, not Sprint 1 wholesale. The MVP does not become a full accounting system, the modular monolith remains, and critical booking, financial, voucher, gift-card, inventory and commission operations require durable idempotency. Every owning sprint must update SRS/PRD, ERD when applicable, OpenAPI, event catalog and tests.

## Approved dispositions

| ID     | Decision and binding rules                                                                                                                                                                                                                                                                                                                                 | Owning sprint                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| CR1-01 | `PARTIALLY_COMPLETED` is system-derived only for a multi-item booking with at least one completed item and at least one unfinished/cancelled/unfulfillable item before final completion. Item/session states remain independent; clients cannot command this state; derivation history/event is auditable.                                                 | Booking and Service Execution                            |
| CR1-02 | MVP supports tenant default and branch service price with effective start, optional end, no same-scope overlap and confirmation snapshot. Backend returns `pricingTrace`; discounts/vouchers apply after one base price. Manual override requires permission, reason and audit. Advanced dimensions and the approved precedence chain are post-MVP.        | Service Catalog; advanced rules post-MVP                 |
| CR1-03 | Platform Super Admin has no default tenant business-data access. Sprint 1 establishes the policy boundary only. Full owner-granted, scoped, time-bound, read-only-by-default and revocable Support Access Grant plus short audited break-glass flow belongs to SaaS Administration. Tokens, passwords, raw card data and audit deletion are never exposed. | Sprint 1 boundary; full flow SaaS Administration         |
| CR1-04 | All domain/outbox events use the approved versioned event envelope. Consumers deduplicate by `eventId`; incompatible payload changes increment `eventVersion`; aggregate version detects gaps; sensitive data is prohibited.                                                                                                                               | Sprint 1 onward                                          |
| CR1-05 | Review is a capability across CRM, Service Experience and Marketing; it may remain a module inside the monolith. MVP Accounting is limited to reconciliation, revenue/tax/tip/refund/cash-session/credit-note/export capabilities under Finance/Reporting; no general ledger or complete AP/AR.                                                            | CRM/Growth; POS/Reporting                                |
| CR1-06 | Gift-card issue/top-up/redeem/cancel/refund and commission lock/reopen/adjustment/payout batch require idempotency. Same key/same payload replays; same key/different payload conflicts; ledgers use unique references and consumers deduplicate.                                                                                                          | Membership/Growth; Commission                            |
| CR1-07 | Paid invoices are immutable. Credit notes reference originals and adjust all affected ledgers. Replacement invoices retain the old record and audit chain and are retry-safe.                                                                                                                                                                              | POS/Finance or immediate Finance hardening after POS MVP |
| CR1-08 | Offline operations include operation/version, tenant/branch/user/device/session, client time, base entity version, payload and client app identity. Server derives authority from the authenticated session and persists processing state; retry uses `operationId`. Critical operations await server confirmation.                                        | Mobile Offline Foundation and owning domain sprints      |
| CR1-09 | Sprint 1 baseline includes structured/redacted logs, request/correlation ID, error tracking, API/database latency, error rate, health/readiness, worker/queue/WebSocket and auth-security signals. Booking/payment and production signals are added in their owning phases.                                                                                | Sprint 1 baseline; domain/production extensions later    |
| CR1-10 | API adopts NestJS Fastify while the controller surface is small. Auth, cookies if used, multipart, rate limiting, CORS, Swagger, WebSocket, filters, request IDs, integration and load smoke tests must be verified. Performance claims require measurements.                                                                                              | Sprint 1                                                 |

## Approved pricing precedence for post-MVP rules

`approved manual override → customer contract → campaign → branch + technician level → branch + time window → branch service price → tenant default service price`.

Only one base price is selected. Rules do not stack unless explicitly modeled as a surcharge. Money is calculated on the backend.

## Deferred implementation guardrail

The following are approved requirements but must not be implemented before their owning sprint: advanced dynamic pricing, gift cards, credit notes, replacement invoices, review workflows, advanced accounting, full support impersonation and derived `PARTIALLY_COMPLETED` behavior.

## Closure evidence

- Decisions incorporated into the SRS/PRD addendum.
- Requirements source register reconciled.
- Event catalog and versioning rules created.
- ADRs created for Fastify, event envelope, observability and support access.
- ERD and migrations unchanged, as directed.
- Documentation validation completed and reconciliation committed separately.
