# Sprint 6 Completion Report

## Status

Sprint 6 implementation and local QA are complete. Product status remains `READY FOR FINAL CI / ACCEPTANCE`; it must not be changed to `DONE` until GitHub Actions succeeds for the exact final commit and BA/Product Owner accepts the checkpoint.

## Git

- Branch: `main`
- Start checkpoint: `cb0377d1d818597dcda8e4cfd864de9c538a0b4a`
- Migrations `0001-0011`: unchanged
- Final commit, origin alignment, Actions run and clean-tree evidence are reported from immutable Git metadata after the final push.

## Migration and seed

- Added reversible migration `0012_pos_invoice_payment_cash_session`.
- Fresh migrate, rollback to `0011`, and re-migrate passed locally.
- Tables cover registers/devices, drawers/sessions/movements, tax profiles, orders/lines/discounts/approvals/pricing revisions, tips/allocations, payments/attempts/allocations, invoices/lines/deliveries, append-only order history, financial events and webhook evidence.
- Composite tenant foreign keys, branch/register scope, partial unique active-order/session constraints and immutable captured-payment/invoice guards are database enforced.
- Deterministic seed includes Cashier and Accountant roles/users plus draft, ready, partial, paid and zero-total orders, split payments, tips, movements, reconciliation and invoice evidence. It contains no real PII.

## POS and pricing

- Appointment checkout creates at most one active order and snapshots completed/cancelled service evidence without mutating booking snapshots.
- Integer-minor-unit pricing implements line/order discounts, tax snapshots, tips, deterministic rounding and exact tip allocation.
- Every repricing appends a pricing revision; the first successful capture locks pricing.
- Discount thresholds create an approval request. Approval, repricing and audit evidence are transactional.
- Finalization supports positive and zero-total orders; appointment state derives `CHECKED_OUT`/`PAID` from PostgreSQL financial evidence.

## Payments, invoice and cash

- Cash and permissioned external-reference capture use strict discriminated request schemas and reject sensitive card fields.
- Partial and split tender, change calculation, idempotent replay, payment-attempt evidence and overpayment protection are implemented.
- Concurrent final capture yields one capture/invoice; loser requests map to a domain conflict instead of HTTP 500.
- Invoice numbering is branch-local and concurrency-safe; issued invoices and lines are immutable.
- Receipt print view and disabled-provider delivery queue are available without exposing payment secrets.
- Cash sessions implement open, movement, begin closing, blind declaration, variance policy, dual-control close and manager reopen. Cash out/drop cannot make expected cash negative.
- Daily reconciliation and owner financial summary are PostgreSQL projections; Redis remains transport/cache only.
- Deposit allocation is represented as a financial-evidence foundation only. No new production deposit gateway, refund or reversal workflow was introduced.

## Authorization and security

- Granular Sprint 6 permissions cover POS, discount approval, payment, invoice, register, cash session and reconciliation commands.
- Owner and branch Manager are branch-scoped operators; Cashier handles POS/cash; Accountant is read-only; Receptionist has limited read access; Technician and Marketing have no financial access by default.
- Platform Super Admin remains denied salon financial data without a Support Access Grant.
- Tenant/branch isolation, idempotency keys, optimistic versions, row/advisory locks, audit logs and durable outbox apply to sensitive commands.
- Provider raw body/signature boundary, opaque references, log redaction and no-card-data validation are documented and tested.

## API and realtime

- Orders: create/list/detail/history, line, recalculate, discount, tip, finalize, payment and void commands.
- Payments/invoices: list/detail, immutable print and delivery request.
- Registers/cash: register list; cash-session list/detail/open/movement/closing/declaration/reopen/close.
- Reporting: daily reconciliation and financial summary.
- OpenAPI version `0.8.0` contains Sprint 6 request/response schemas and command routes.
- Financial outbox events route tenant-, branch-, register-, session-, order- and appointment-scoped refetch signals without PII.

## UI and mobile

- Admin Web provides real POS checkout, discount/tip/finalization/payment, receipt, register, cash-session, reconciliation and permission-state screens.
- Screens include loading, empty, error, retry, offline, validation, version-conflict, permission-denied and success states.
- Owner Mobile consumes the real read-only financial summary API and refetches on realtime invalidation.
- Cashier deep E2E validates the real UI against the authenticated API and PostgreSQL. Staff Mobile has no unauthorized financial actions.

## Tests and local QA

- Lint: 13/13 packages passed.
- Typecheck: 13/13 packages passed in strict mode.
- Unit/mobile: 25 files, 70 tests passed, including 7 pricing tests and Sprint 6 mobile scope.
- Contract: 1/1 OpenAPI contract test passed.
- Full PostgreSQL regression: Sprint 1-6 integration suite passed.
- Sprint 6 integration/concurrency/security: 7/7 passed.
- Authenticated Sprint 6 E2E: 3/3 passed after deterministic reset.
- Build: 13/13 packages passed, including Admin Web, API, Worker, Booking Web and both Expo web exports.
- Formatting was applied to every Sprint 6 changed text/source file. Repository-wide Prettier check still reports pre-existing formatting debt outside the Sprint 6 change set and is not represented as green.

## Performance

- Dataset: deterministic local QA fixture; this is not a production performance claim.
- Concurrency 2 local p95: order list 6.56 ms, financial summary 8.93 ms, daily reconciliation 9.22 ms, invoice list 5.98 ms.
- Error rate: 0% for the four Sprint 6 smoke scenarios.
- Production-like 100k-order/200k-payment benchmark and hot-order soak remain release blockers in the technical-debt register.

## Architecture decisions

- ADR 0028: POS Order Aggregate.
- ADR 0029: Money, Tax and Rounding.
- ADR 0030: Payment Idempotency and Provider Boundary.
- ADR 0031: Invoice Immutability and Numbering.
- ADR 0032: Cash Session Reconciliation.
- Existing multi-tenancy, authentication, idempotency, durable outbox, realtime and offline ADRs remain authoritative.

## Local run

```bash
# Docker is used only during QA and is stopped when QA completes.
docker compose up -d
pnpm db:reset
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e tests/e2e/sprint6-pos-ui.spec.ts
pnpm load:smoke
pnpm build
docker compose down
```

## Scope confirmation

- Refund and Credit Note are not implemented.
- Commission and Payroll are not implemented.
- Inventory deduction, Voucher, Membership/Package and Gift Card are not implemented.
- Production card terminal/provider and e-invoice filing are not faked; they remain explicit release configuration or later approved scope.
- Sprint 7 has not started.
