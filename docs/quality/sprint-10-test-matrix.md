# Sprint 10 Test Matrix

| Risk                  | Automated evidence                                                                                                  | Result |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Ledger/direct edit    | Append-only update/delete denial and projection-guard PostgreSQL tests                                               | Passed |
| Tenant/customer scope | Composite FK, cross-tenant not-found, own-wallet filtering and Platform denial                                      | Passed |
| Activation/reload     | Funding capture, currency, unique payment, retry and concurrent command tests                                       | Passed |
| Redemption            | Eligible due excludes tip/Gift Card line; partial reserve, split tender, release and paid commit                    | Passed |
| Concurrency           | Account/order reservation, checkout, duplicate capture, replacement, reload and adjustment decision                | Passed |
| Refund                | Exact settlement cap/restore, customer-credit destination exclusivity and unused purchase cancellation             | Passed |
| Security              | Masked output, no hash/PIN response, persisted lookup lockout and role matrix                                       | Passed |
| Worker                | TTL release, daily snapshot idempotency, reconciliation exception and delivery/export routing                      | Passed |
| UI/mobile             | Admin/POS real API screens, Owner summaries, Staff limited state and authenticated mobile smoke                    | Passed |
| Contract              | OpenAPI parses and Sprint 10 routes/schemas/error codes are present                                                  | Passed |
| Migration             | Fresh `0019`, down to `0018`, re-up and deterministic seed replay                                                    | Passed |
| Regression            | 34 unit/mobile files (112 tests), 45 fixture-isolated integration files, lint/typecheck/build 13/13                | Passed |
| Deep E2E              | Purchase/redemption/refund, customer-credit refund and dual-control authorization scenarios                        | 3/3    |
| Local load            | 2,727 authenticated requests across four read scenarios, zero errors/timeouts, p95 6.92–8.53 ms (not production) | Passed |

Exact-final-commit GitHub Actions remains the acceptance gate and is reported at handoff.
