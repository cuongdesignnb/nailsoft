# Sprint 9 Completion Report

Status: DONE — accepted by BA/Product Owner as the Sprint 10 start checkpoint.

## Git

- Branch: `main`
- Start checkpoint: `552de530fcbcee1295d638ee10a46944253d31c0`
- Implementation commit: `f6909e167d7a861c8af5746fd8c275098a0349a8`
- Implementation CI: [run 30339147966](https://github.com/cuongdesignnb/nailsoft/actions/runs/30339147966) — `SUCCESS`
- Accepted CI hotfix commit: `c248f1b1d0fe35ab415551c30c1acfcf8d809724`.
- Accepted final evidence commit: `eccc1d0c5b32acb48504ab15747e7be1895a628c`.
- Accepted final CI: [run 30349195280](https://github.com/cuongdesignnb/nailsoft/actions/runs/30349195280) — `SUCCESS`.
- Closure evidence commit: this document update; exact SHA and CI are reported at handoff because a commit cannot contain its own hash.
- Working tree: clean after final commit and push verification.

## Delivery

- Migration: `0018_inventory_supplier_purchase_operations` (fresh, rollback to `0017`, re-migrate and deterministic seed replay passed)
- Catalog: UOM, exact conversion, categories, items/barcodes, branch settings, locations and lots.
- Stock: immutable physical ledger, balance projection, reservations, FEFO and moving-average cost.
- Purchasing: suppliers, purchase orders, receipts, transfers and variance evidence.
- Operations: adjustments, blind counts, alerts, valuation/export jobs.
- Integrations: service recipes/reserve/consume/release; retail POS reservation/paid commit; inspection-first retail return.
- UI: Admin Inventory workspace, Owner inventory views/actions, Staff own-material views.
- Worker: expiry, low stock, reservation expiry and bounded leased jobs.

## QA

- Lint: 13/13 packages passed.
- Typecheck: 13/13 packages passed.
- Unit/mobile/hotfix: 32 files, 104 tests passed, including 7 database-reset retry tests.
- Contract: 1 file, 1 test passed.
- Build: 13/13 packages passed, including Admin Web and both Expo web exports.
- PostgreSQL integration/concurrency/security: 43 sequential fixture-isolated files passed; Sprint 9 focused results 12/12.
- Migration fresh/down/up and deterministic seed replay: passed.
- Authenticated deep E2E: 5/5 (independent PO approval/receipts, in-transit transfer, blind count, actual service consumption, sale/refund/explicit return posting).
- Local capacity smoke: 16,262 requests across four read scenarios, 0% errors; p95 12.93–16.80 ms.
- Docker after QA: `DOCKER_SERVICES_RUNNING=0` (`docker compose ps -q` returned empty).

## CI Infrastructure Hotfix

- Prior closure evidence commit: `ea1646496471aef7b41dd49ff4d065c4e9213bd7`.
- Failure: PostgreSQL schema-reset deadlock `40P01` during Sprint 8 closure authenticated E2E.
- Classification: test-infrastructure deadlock; no evidence of product-logic failure.
- Product logic impact: none.
- Hotfix: bounded retry for schema-reset deadlocks only; maximum 4 attempts with `250,500,1000` ms backoff and no jitter.
- Client lifecycle: a new PostgreSQL client per attempt, safe rollback, and `client.end()` in `finally`.
- Fail-fast: every non-`40P01` error; migration and seed are never retried by the reset loop.
- Credential safety: reset logs contain attempt/result metadata only; no database URL, password, connection string, or raw environment.
- Hotfix commit: `c248f1b1d0fe35ab415551c30c1acfcf8d809724`.
- Hotfix CI: [run 30347571395](https://github.com/cuongdesignnb/nailsoft/actions/runs/30347571395) — `SUCCESS`.
- Relevant local QA: two consecutive reset/seed cycles with API/Worker active, followed by voucher and loyalty paid/refund E2E; both passed.
- Root `pnpm test` note: its monolithic integration invocation is not fixture-isolated and produced 19 shared-dataset assertion failures; the fixture-isolated full CI matrix passed. No business assertion was weakened for this hotfix.
- Final evidence commit: this report update; exact SHA and exact-final-commit CI are reported at handoff.
- Docker services after QA: `0`.

## Scope confirmation

Sprint 10 gift cards/stored value, payroll, marketing and AI were not implemented. Refund completion never automatically restores physical stock.
