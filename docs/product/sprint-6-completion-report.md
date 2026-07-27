# Sprint 6 Completion Report

## Status

Sprint 6 closure implementation, local QA and closure CI are complete. Product status is `IN PROGRESS` pending BA/Product Owner acceptance. All technical closure criteria are met; Sprint 7 has not started.

## Git

- Branch: `main`
- Sprint 6 closure checkpoint: `b52e4b723414e16d3cb01ca9439ca3caab77317e`
- Sprint 6 feature commit: `8a6556d375ebb6f421d84d2693b6321906bb74c9`
- Sprint 6 closure implementation commit: `3c3688ea924ad85d0c1d13867cd5310f2900b8e6`
- Migrations `0001-0012`: unchanged
- Closure migration: `0013_sprint6_financial_attribution_hardening`
- Closure implementation commit was aligned with `origin/main` and its working tree was clean before this evidence-only report update.

## Closure CI

- Run ID: `30243405219`
- URL: <https://github.com/cuongdesignnb/nailsoft/actions/runs/30243405219>
- Commit: `3c3688ea924ad85d0c1d13867cd5310f2900b8e6`
- Status: `SUCCESS`
- Duration: 11m51s
- Evidence-report HEAD must also pass CI before final handoff.

## Register trust boundary

- Register authorization is derived exclusively from the authenticated `auth.sessionId` and its active `device_sessions.device_id` relation.
- Client-supplied `deviceId` is accepted only for legacy request compatibility and is ignored for authorization.
- Register-bound POS creation, register assignment, finalization, payment and every cash-session command require an active same-tenant, same-user, same-branch device session and a non-revoked register binding when the register requires one.
- Owner/Manager roles have no implicit device-binding bypass.
- Spoofed device identifiers, inactive/revoked sessions and unbound devices map to explicit domain errors instead of HTTP 500.

## Register and cash attribution

- Added command-specific `POST /v1/pos-orders/{orderId}/assign-register` for unlocked DRAFT orders with no payment evidence.
- A non-DRAFT order must have one immutable register; database triggers block later register changes after finalization or payment evidence.
- Every captured payment has an immutable `register_id`, including cash and external-reference payments.
- Cash capture requires the cash session, payment and order to share the same register.
- Split cash tender remains tied to the original cash session; mismatches return `PAYMENT_REGISTER_MISMATCH` or `PAYMENT_CASH_SESSION_MISMATCH`.
- Migration backfill selects deterministic same-branch attribution and fails closed when no valid attribution exists.

## Blind cash count

- An owning Cashier sees `blindCount=true` while a session is `OPEN` or `CLOSING`.
- Expected cash, variance, variance reason/approval and movement amounts are API-redacted; clients cannot sum movements to reconstruct expected cash.
- Blind enforcement applies to list, detail, movement-list and command responses, not only the Admin Web presentation.
- A Manager/Owner with `cash_session.approve_variance` uses the separate closing-review endpoint to see reconciliation evidence.
- Closed sessions reveal expected, declared and variance values according to permission scope.

## Financial reconciliation

- Daily reconciliation uses captured payment evidence as the collection source of truth and invoice evidence for service sales, discount, tax and tip composition.
- Filters include tenant, branch, business date, immutable register attribution, capture actor/cashier, payment method, payment status, invoice status and cash-session status.
- Register filtering includes both cash and external-reference payments.
- Cashier attribution uses immutable capture actor (`payments.created_by_user_id`) rather than current session owner.
- Response includes paid order count, service sales, discount, tax, tip, service/tip/total collected, payment mix, expected/declared/variance cash and applied-filter metadata.
- Payment allocation joins aggregate before projection so captured amounts are not duplicated.

## Migration and deterministic seed

- Fresh migrate through `0013`: passed.
- Rollback from `0013` to `0012`: passed with captured payments and issued invoices preserved.
- Re-migrate to `0013`: passed with data preserved.
- Composite tenant/register foreign keys, non-null captured-payment attribution, immutable order attribution and reporting indexes are database-enforced.
- Seed assigns deterministic register attribution to every Sprint 6 order/payment and contains no real PII.

## API, UI and realtime

- OpenAPI version `0.8.1` documents register assignment, immutable payment attribution, manager closing review, blind fields and expanded reconciliation filters/response.
- Admin Web requires or assigns an authorized register before finalization and filters cash-session selection by the order register.
- Cash-session screens render redacted values as `Hidden`, never as a misleading zero.
- Existing transactional audit, durable outbox and realtime refetch signals remain in place; PostgreSQL is the source of truth.

## Tests and local QA

- Lint: 13/13 packages passed.
- Typecheck: 13/13 packages passed in strict mode.
- Unit/mobile: 25 files, 72 tests passed.
- Contract: 1/1 OpenAPI contract test passed.
- Full PostgreSQL integration/regression suite: passed, including Sprint 1-6 tests.
- Closure integration: device binding, register/cash attribution, reconciliation filters and blind count passed.
- Closure authenticated deep E2E: 4/4 passed.
- Existing authenticated Sprint 6 POS UI E2E: 3/3 passed.
- Build: 13/13 packages passed, including Admin Web, API, Worker, Booking Web and both Expo web exports.
- Docker was used only for QA, then stopped. Final `docker compose ps` output was empty: `DOCKER_SERVICES_RUNNING=0`.

## Performance

- Dataset: deterministic local QA fixture; this is not a production performance claim.
- Duration: 2-second measurement per scenario after 1-second warm-up, concurrency 2.
- POS order list: 598 requests, p95 8.32 ms, error rate 0%.
- Financial summary: 433 requests, p95 10.78 ms, error rate 0%.
- Daily reconciliation: 501 requests, p95 9.33 ms, error rate 0%.
- Invoice list: 646 requests, p95 7.48 ms, error rate 0%.
- Production-like 100k-order/200k-payment benchmark and hot-order soak remain release technical debt; local numbers are not a production SLA claim.

## Architecture decisions

- ADR 0032 updated: cash-session reconciliation and blind-count visibility.
- ADR 0033 added: authenticated register-device trust and immutable financial attribution.
- Existing multi-tenancy, authentication, idempotency, durable outbox, realtime, POS aggregate, money/tax, payment boundary and invoice immutability ADRs remain authoritative.

## Technical debt and risk

- Production payment terminal/provider integration remains disabled and must not be simulated as completed.
- Production e-invoice filing remains outside the current implementation.
- Production-scale reconciliation/load evidence remains a release-stage activity.
- Refund, reversal and chargeback workflows require separately approved scope and financial evidence design.

## Local QA run

```bash
# Docker is enabled only for database-backed QA and is stopped afterward.
docker compose up -d
pnpm db:reset
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e tests/e2e/sprint6-pos-ui.spec.ts
pnpm test:e2e tests/e2e/sprint6-*-deep.spec.ts
pnpm load:smoke
pnpm build
docker compose down
docker compose ps
```

## Scope confirmation

- Refund, Credit Note, reversal and chargeback are not implemented.
- Commission and Payroll are not implemented.
- Inventory deduction, Voucher, Membership/Package and Gift Card are not implemented.
- Marketing and AI are not implemented.
- Production card terminal/provider and e-invoice filing are not faked.
- Sprint 7 has not started.
