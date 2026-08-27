# NailSoft — End-to-End Business Journey QA Final Report

## Executive result

GOAL=NAILSOFT_BUSINESS_JOURNEY_QA
FINAL_SOURCE_SHA=9e477bafa2f00e8dc6e73fb8affe4a6b48754937
FINAL_CI_RUN_ID=NOT_RUN_LOCALLY
FINAL_CI_CONCLUSION=LOCAL_GATES_PASS
STATUS=BLOCKED

The supported salon operating-system journeys are green in the non-production QA environment. The mandatory acceptance gate cannot be closed because Golden Flow G3 requires authoritative Booking and Revenue Attribution, while the current Marketing domain explicitly reports both capabilities as unsupported. No synthetic attribution was introduced.

## Environment and safety

- Environment: deterministic non-production QA database and isolated browser/API/worker processes.
- Production deployment: NO.
- Production data mutation: NO.
- System payment flow: QA sandbox only.
- Live external email delivery: NOT TESTED.
- External provider sandbox: NOT TESTED.
- Task-created Docker containers after teardown: `0`.
- Existing user worktree changes and generated artifacts were preserved; no reset or broad cleanup was performed.

## Journey result

- Total journeys: `40`.
- PASS: `38`.
- PASS_WITH_NA: `2` — J18 marketing attribution portion and J19 unsupported birthday/Customer Credit expiry semantics.
- PARTIAL_NOT_EXPLICIT: `0`.
- Journey execution failures: `0`.
- P0 open: `0`.
- P1 open: `0`.

The complete row-by-row evidence is in [JOURNEY_EVIDENCE_MATRIX.md](./business-journeys/JOURNEY_EVIDENCE_MATRIX.md) and [BUSINESS_JOURNEY_ROUTE_COVERAGE.md](../../docs/qa/BUSINESS_JOURNEY_ROUTE_COVERAGE.md).

## Golden flows

### G1 — Full salon journey

`GOLDEN_FLOW_G1=PASS`

Verified register/session setup, new and returning walk-in, appointment lookup, check-in, staff assignment, service execution, add-service, checkout, cash payment, invoice issuance, benefit reads, commission evidence, Customer Care call/follow-up, follow-up completion, and cash-session close.

### G2 — Service recovery and refund

`GOLDEN_FLOW_G2=PASS`

Existing service-recovery, refund, credit-note, stored-value, loyalty, package, voucher, reconciliation, accounting, and downstream evidence suites passed. The QA run did not create a parallel recovery domain.

### G3 — Customer returns via Marketing

`GOLDEN_FLOW_G3=BLOCKED_UNSUPPORTED_DOMAIN`

The supported portion passed: campaign lifecycle, consent, audience snapshot, suppression, frequency cap, quiet hours, and email delivery-state behavior. The blocker is authoritative attribution:

- `apps/api/src/modules/engagement/marketing.service.ts` returns `openTracking: false`, `clickTracking: false`, `bookingAttribution: false`, and `revenueAttribution: false` in the Marketing overview and campaign overview read models.
- The current campaign report exposes audience/message counts and timestamps, not a persisted campaign-to-booking or campaign-to-revenue relation.
- Worker preflight and delivery checks were verified; they do not create booking/revenue attribution.
- The QA suite asserts unsupported Open/Click/Booking/Revenue metrics are not rendered or fabricated.

`MARKETING_NO_CONSENT_EXCLUSION=PASS`.

## Resilience and state persistence

The dedicated [qa-journey-resilience.spec.ts](../../tests/e2e/qa-journey-resilience.spec.ts) passed in the full run:

- J34: Marketing filters and selected Campaign survive reload and browser back; a second tab rebuilds the same URL state independently.
- J35: Customer Care directory request interruption recovers through the server-backed Retry action; an offline Customer Care write is rejected and remains open for the user to retry, without offline queue or local persistence.

## Defects found and fixed

- [pos.service.ts](../../apps/api/src/modules/pos/pos.service.ts): commission evidence no longer truncates sub-second service durations before proportional calculation.
- [customer-care.service.ts](../../apps/api/src/modules/engagement/customer-care.service.ts): follow-up completion casts the authenticated actor to the UUID column type.
- [sprint19-wave0-shell.spec.ts](../../tests/e2e/sprint19-wave0-shell.spec.ts): visual test clock is deterministic; production date behavior is unchanged.
- Wave 7 availability/confirmation tests now allow the intentional multi-date search loop to complete.

All fixes were re-tested by the targeted suites and the final full E2E run.

## Local gates

| Gate | Result |
|---|---|
| Admin lint | PASS |
| Workspace lint | PASS; pre-existing generated declaration excluded only during the check and restored byte-for-byte |
| Typecheck | PASS — 16/16 |
| Build | PASS — 16/16 |
| Unit | PASS — 66 files / 218 tests |
| Contract | PASS — 27 files / 61 tests |
| Integration | PASS — 125 files, exit 0 |
| Full isolated E2E | PASS — `E2E_ISOLATED_PASS=114/114` |
| Security scan | PASS — 1,153 tracked files, no private-key/token signatures |
| Security evidence | PASS_WITH_TIME_LIMITED_EXCEPTION — 0 critical, 0 untriaged high exploitable; 2 documented no-patch high exceptions under `SEC-2026-IMAGE-SIZE-METRO` |
| DB integrity | PASS — migration head `0040_customer_care_engagement_hub`, orphan branches/appointments `0/0` |
| Git diff check | PASS |

## Integrity, security, and privacy

- Tenant and branch isolation suites passed.
- Permission negative matrix passed.
- Customer PII and audience redaction checks passed.
- Internal Note privacy and Customer Care permission checks passed.
- Consent, suppression, frequency cap, and quiet-hour preflight checks passed.
- No provider credentials, contact hashes, unsubscribe tokens, or raw provider payloads were exposed.
- No fake Open, Click, Booking, Revenue, SMS, or delivered-event metrics were added.

## Evidence index

- [QA progress ledger](./../../docs/qa/NAILSOFT_BUSINESS_JOURNEY_QA_PROGRESS.md)
- [Journey evidence matrix](./business-journeys/JOURNEY_EVIDENCE_MATRIX.md)
- [Route coverage](../../docs/qa/BUSINESS_JOURNEY_ROUTE_COVERAGE.md)
- [E2E summary](./business-journeys/00-environment/e2e-summary.md)
- [Local gates](./business-journeys/00-environment/local-gates.md)
- [G1 evidence](./business-journeys/G1_FULL_SALON_JOURNEY.md)
- [G2 evidence](./business-journeys/G2_SERVICE_RECOVERY.md)
- [G3 evidence](./business-journeys/G3_MARKETING_RETURN.md)

## Required next product capability

To remove the blocker, the Marketing domain must add and persist a documented attribution model containing at least campaign, customer, booking/conversion event, attribution window/model, source timestamp, and paid invoice/order evidence with refund and currency handling. Until that exists, G3 and `MARKETING_ATTRIBUTION` must remain blocked and the product must not claim booking or revenue results.
