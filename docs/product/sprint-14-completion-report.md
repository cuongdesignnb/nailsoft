# Sprint 14 Completion Report

## Status

STATUS=BA_PO_ACCEPTED
SPRINT_14=DONE
SPRINT_14_FINAL_COMMIT=d1c9eea1bf51e9c6212f28a781c3b277cdbbef6a
SPRINT_14_FINAL_CI=30687504311
SPRINT_14_FINAL_CI_STATUS=SUCCESS
DOCKER_COMPOSE_RUNNING_SERVICES=0

Sprint 15 is authorized from this checkpoint; Sprint 16 is not authorized and UX/UI redesign remains deferred.

## Git checkpoint

- Start checkpoint: `1ce6a8c92d0d37ed2f8cc1244ce83e2bf64531ae`
- Foundation migration: `0028_general_ledger_accounting_bank_reconciliation`
- Closure migration: `0029_sprint14_accounting_correctness_closure`
- Final closure migration: `0030_sprint14_source_reconciliation_statement_closure`
- Docker policy: start only for QA, stop after QA.

## Delivered foundation

- Tenant-scoped accounting book, fiscal year and non-overlapping period schema.
- Versioned chart of accounts, dimensions, cost centers, tax codes and posting-rule placeholders.
- Posting candidates, double-entry journals, approval history, immutable posted-line guards and reversal links.
- Opening balance import foundation, open items, bank statement/reconciliation tables, close checklists and report snapshot/export foundations.
- Accounting API module for book/account/period/journal lifecycle, posting candidates, reports, open items and bank account reads.
- Accounting permissions, audit and outbox hooks for core commands.

## Closure implementation

- 0029 adds command idempotency storage, journal number sequences, posting-worker lease fields, period approval evidence and PostgreSQL guards for posted-line immutability, posted journal numbers, double-entry balance, tenant/book scope, account cycles/activity, opening-balance scope, bank statement append-only facts, match caps and final statement snapshots.
- Journal posting now locks the period, validates date/state/balance and allocates a monotonic book/fiscal-year journal number.
- Opening-balance posting creates one balanced `OPENING_BALANCE` journal rather than changing state only.
- Explicit journal and period command routes use granular permissions; self-approval remains denied.
- Reversal request/approval creates a compensating journal and marks the original reversed only after the compensating journal posts.
- Period close blocks unresolved posting candidates and non-terminal journals; Accounting control-center UI exposes books, periods, journals, posting queue, reports, open items and reconciliation states with loading/empty/error/permission/retry states.
- Source posting worker resolves source payload/mapping versions, creates balanced journals exactly once, auto-posts only for configured AUTO_POST books, and moves missing/ambiguous mappings to REVIEW_REQUIRED.
- POS/refund/stored-value/inventory/payroll/tip/platform source types are explicit adapter boundaries; source domain rows remain unchanged.
- Bank account creation, CSV import, stable checksum/line fingerprints, match allocation, confirm/unmatch, reconciliation close and dual-control void commands are implemented.
- Trial Balance includes opening/period/closing columns; P&L exposes revenue/contra-revenue/COGS/gross profit/operating expenses/operating profit; Balance Sheet includes current-period earnings in equity; statement snapshots have generated/approved/final transitions.

## Verification evidence

- `pnpm typecheck`: PASS (13 packages).
- `pnpm lint`: PASS (13 packages).
- `pnpm build`: PASS (13 packages).
- `pnpm test:unit`: PASS (45 files, 152 tests).
- Docker QA: PASS — fresh reset, rollback from 0029 to 0028, re-migrate, seed and targeted PostgreSQL closure integration (2 tests); Docker services stopped after QA.
- Full integration runner: the Redis adapter close hook was added to remove the prior app-lifecycle hang; final CI must provide exact-run evidence.

## Final closure QA

- Docker QA: fresh reset, rollback from 0030 to 0029, re-migrate, seed and targeted PostgreSQL closure/source-bank integration passed; Docker services were stopped after QA.
- Targeted QA result: source/reconciliation integration 2/2 and prior closure integration 2/2 passed; API/Worker typecheck, lint, build, contract tests and unit regression passed.
- Authenticated E2E was added to CI and the transition-period SQL bind bug found during local QA was fixed before the final commit.
- Exact final CI run `30687504311` passed on `d1c9eea1bf51e9c6212f28a781c3b277cdbbef6a`.

## QA still required

- Production bank-feed credentials, tax filing integration, provider sandboxes and production-scale soak remain technical debt; no Sprint 15 work is started.
