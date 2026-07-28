# Sprint 8 Closure Report

Status: IN PROGRESS — TECHNICALLY READY; PENDING FINAL GITHUB ACTIONS AND BA/PRODUCT OWNER ACCEPTANCE.

## Git

- Branch: `main`
- Start checkpoint: `44c10065ed3f39f2887947028cb3830833ef3ff3`
- Feature commit: `44c10065ed3f39f2887947028cb3830833ef3ff3`
- Closure commit: identity of the commit containing this report, recorded in the final handoff
- Final evidence commit: same closure commit unless QA requires a follow-up correction
- `origin/main`: recorded after the exact commit passes GitHub Actions
- Working tree: must be clean before acceptance request

## CI and Docker

- Final GitHub Actions run ID/URL/status: pending exact closure commit.
- Local Docker was used only for QA and was shut down afterward; final `docker compose ps` returned no services (`DOCKER_SERVICES_RUNNING=0`).
- Containers belonging to other projects are not changed.

## Migration and seed

- `0016_voucher_loyalty_membership_package` remains unchanged.
- `0017_sprint8_benefit_correctness_hardening` adds covered-line package uniqueness, loyalty reservation contracts/FIFO lots, voucher customer-use projection, append-only settlement/refund allocations, rolling membership metrics and Worker dead-letter metadata.
- Fresh migrate, deterministic seed replay, rollback to `0016`, re-migrate to `0017` and seed replay all passed in local Docker QA.
- No migration `0001–0016` was modified.

## Loyalty

- Loyalty cannot cover tip; requested, accepted, applied and unused points are stored exactly.
- FIFO lots are allocated at reservation. Commit consumes the reservation allocation; release restores only still-valid points; expiry sees only unreserved balance.
- Settlement computes original earn minus completed-refund reversals and prior settlement, so a fully refunded pending earn cannot become available.
- Partial earn and redemption reversals are deterministic and bounded by immutable line/application evidence.

## Package

- Required units come from the matched eligibility item; client `units` is only a compatibility assertion.
- Package applications are unique per covered order line, allowing multiple package-covered services in one order.
- Confirmed appointments receive grace; checked-in/in-service reservations do not expire; completed appointments retain reservation through checkout grace.
- Paid settlement commits the exact reserved units. A fully refunded covered line restores whole units; a partial line becomes `MANUAL_REVIEW` pending an approved fractional-unit policy.

## Membership

- Rolling and lifetime spend derive from issued financial evidence minus completed service/tax refunds; tip is excluded.
- Payment and completed refund enqueue reevaluation.
- Evaluation supports upgrade, no-op, downgrade and no-qualifying-tier removal under an advisory lock.
- Manual assignments are protected. `grace_until` protects an automatic tier from a downgrade until policy grace ends.

## Voucher

- Tenant/campaign/customer advisory locking protects `active reservations + net committed uses < per-customer limit` across codes.
- Proportional refund restoration decreases net customer usage rather than restoring a whole use.
- Multi-use codes preserve remaining capacity while another reservation is active.
- Fixed campaigns are checked against server-resolved order/branch currency; mismatch returns `VOUCHER_CURRENCY_MISMATCH`.

## Worker

- Jobs are claimed and leased in one short transaction, then each job runs in an independent transaction.
- Retries are bounded and exhausted jobs move to `DEAD_LETTER` with safe error metadata.
- Expiry rows are isolated with savepoints so one invalid row cannot roll back the batch.

## API, UI and documentation

- Existing Admin Web, Booking Web, Owner Mobile and Staff Mobile Sprint 8 flows remain in scope and unchanged in purpose.
- OpenAPI, Benefits API draft, ERD, event catalog, ADR 0045, test matrix and technical-debt register document closure semantics.
- PostgreSQL remains authoritative; outbox/realtime only invalidate clients for refetch.

## Tests

- Unit: benefit order/rounding plus the loyalty tip-boundary redemption contract.
- Integration: ten focused PostgreSQL suites cover tip boundary, package units/multi-line, refund settlement, rolling membership, appointment lifecycle, voucher concurrency/currency, lot expiry, refund allocation and Worker isolation.
- Authenticated E2E: voucher paid/refund, loyalty tip/paid/refund, package paid/refund, membership upgrade/downgrade and multi-line zero-total settlement.
- Existing Sprint 1–7 regression, contract, mobile, load-smoke and build lanes remain enabled.
- Local QA: lint passed; typecheck passed; 29 unit files/91 tests passed; contract passed; all 40 PostgreSQL integration files passed; all five new authenticated closure E2E scenarios passed; build passed for all 13 packages.
- Migration QA: fresh migrate/seed, rollback to `0016`, re-migrate to `0017` and deterministic seed replay passed.
- Exact final GitHub Actions evidence: pending the closure commit.

## Scope confirmation

- Inventory and Gift Card were not implemented.
- Payroll payout was not implemented.
- Marketing automation and AI were not implemented.
- Sprint 9 was not started.
- Sprint 8 must not be marked `DONE` until final CI is green and BA/Product Owner accepts it.
