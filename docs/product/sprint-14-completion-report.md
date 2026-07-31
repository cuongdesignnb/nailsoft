# Sprint 14 Completion Report

## Status

Foundation is accepted; closure remains IN_PROGRESS pending authenticated E2E and final CI acceptance. Sprint 15 is not authorized and UX/UI redesign remains deferred.

## Git checkpoint

- Start checkpoint: `f5d8b92287d27b773fabde4a6d1b602851bf231c`
- Foundation migration: `0028_general_ledger_accounting_bank_reconciliation`
- Closure migration: `0029_sprint14_accounting_correctness_closure`
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

## Verification evidence

- `pnpm typecheck`: PASS (13 packages).
- `pnpm lint`: PASS (13 packages).
- `pnpm build`: PASS (13 packages).
- `pnpm test:unit`: PASS (45 files, 152 tests).
- Docker QA: PASS — fresh reset, rollback from 0029 to 0028, re-migrate, seed and targeted PostgreSQL closure integration (2 tests); Docker services stopped after QA.
- Full integration runner: the Redis adapter close hook was added to remove the prior app-lifecycle hang; final CI must provide exact-run evidence.

## QA still required

- Authenticated E2E and full regression CI on the exact final commit.
- Deeper source-adapter/bank reconciliation command E2E evidence remains a tracked closure risk; no Sprint 15 work is started.
