# Sprint 10 Completion Report

Status: READY FOR BA/PO ACCEPTANCE — local closure criteria passed. Acceptance still requires GitHub Actions for the exact final commit to succeed.

## Git

- Branch: `main`
- Start checkpoint: `eccc1d0c5b32acb48504ab15747e7be1895a628c`
- Closure evidence commit: this report update; exact SHA and exact-final-commit CI are reported at handoff because a commit cannot contain its own hash.
- Working tree: must be clean after final commit and push verification.

## Migration and data

- Migration: `0019_gift_card_customer_credit_stored_value`.
- Fresh migrate, deterministic seed, rollback to `0018`, re-migrate and seed replay: passed.
- Existing Sprint 1–9 migrations were not modified.
- Added product/card/account, immutable ledger, balance projection, reservations, settlement allocations, purchase-refund plan, adjustment, legal-policy, daily snapshot, reconciliation and export foundations.
- Tenant-scoped composite references, uniqueness constraints, append-only guards and projection write guards are enforced in PostgreSQL.

## Delivered functions

- Gift Card product CRUD, issue, funding, activation, masked lookup, suspend/reactivate/cancel, replacement, reload, balance and ledger history.
- Customer Credit account, credit/refund destination, own-wallet balance/history and dual-control adjustment workflow.
- POS funding line and stored-value reserve/release/commit integration, split tender and eligible-due calculation. Gift Card cannot fund Gift Card or tip, and receives no discount.
- Exact stored-value refund restoration from settlement allocation. Customer-credit destination creates credit without duplicating the original tender allocation.
- Unused Gift Card purchase cancellation is limited to a fully unused card and captured original funding; mixed or used cases fail closed for manual review.
- Audit, idempotency, outbox, realtime refetch routing, TTL release, snapshots, reconciliation, delivery and export Worker foundations.
- Stored-value liability and reconciliation reporting count both captured external funding and stored-value settlements without treating Gift Card funding as service revenue.

## API and contracts

- OpenAPI and Sprint 10 API draft cover products, cards, lookup, lifecycle commands, customer credit, reservations, POS redemption, refunds, adjustments, reports, exports and customer wallet endpoints.
- Command validation includes optimistic version, idempotency key, currency/minor-unit amount, dual-control reason and refund destination.
- Domain/database conflicts map to stable stored-value error codes instead of unhandled `500` responses.

## Authorization and security

- Owner/Manager/Cashier/Accountant/Technician/Marketing/Platform role boundaries are documented and tested.
- Technician and ungranted Platform Super Admin are denied salon stored-value data.
- Public lookup exposes masked card identity only; token/PIN hash and full credentials never appear in API, audit, event or logs.
- HMAC tokenization, persisted attempt/lockout state, tenant scope, rate-limit seam, dual control and non-PII event payloads are implemented.
- Expiration, dormancy and breakage remain disabled until a versioned jurisdiction policy is approved.

## UI

- Admin Web: Gift Card products, card list/detail/lifecycle actions, Customer Credit, adjustments, liabilities, reconciliation and POS stored-value state use real APIs.
- Owner Mobile: liability, reconciliation and exception summaries with permission-aware manager actions.
- Staff Mobile: limited own-scope state; protected stored-value management actions remain denied.
- Screens include loading, empty, error/retry, permission denied, validation, version-conflict and success feedback states.

## QA evidence

- Lint: 13/13 packages passed.
- Typecheck: 13/13 packages passed.
- Unit/mobile: 34 files, 112 tests passed.
- Contract: 2 files, 3 tests passed.
- PostgreSQL integration/concurrency/security: all 45 fixture-isolated files passed; Sprint 10 focused invariant and Worker suites passed 6/6.
- Authenticated deep E2E: 3/3 scenarios passed (purchase/activate/split redemption/exact restore/unused purchase refund; customer-credit refund; dual-control/role denial).
- Build: 13/13 packages passed, including Admin Web, Booking Web and both Expo web exports.
- Migration fresh/down/up and deterministic seed replay: passed.
- Local capacity smoke: 2,727 requests, 0% errors/timeouts; scenario p95 6.92–8.53 ms. This is local evidence only, not a production performance claim.
- Git diff whitespace check: passed.
- Exact final commit GitHub Actions and clean working tree: verified at handoff.

## Technical debt and release risks

- Production `STORED_VALUE_HMAC_SECRET`, rotation rehearsal and gateway velocity limits are release configuration.
- Email/SMS delivery, private export object generation/download and lifecycle deletion require approved production providers.
- Production-scale million-ledger/hot-account benchmark and long-running Worker/reconciliation soak remain required before go-live.
- Global repository format check still includes pre-existing unrelated formatting debt; changed-file whitespace validation passes and unrelated files were not reformatted.

## Scope confirmation

- Sprint 11 was not implemented.
- Subscription, marketing automation, AI and unapproved expiration/breakage behavior were not implemented.
- PostgreSQL remains the source of truth; Redis/realtime signals are not authoritative.
- Docker is used only for QA and must report `DOCKER_SERVICES_RUNNING=0` at handoff.
