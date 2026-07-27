# Sprint 7 test matrix

| Layer         | Required evidence                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | Refund/period state machines, calendar-window boundary/DST, deterministic proration, rule precedence, commission rounding and locked-period routing         |
| Migration     | Fresh up; `0015 -> 0014 -> 0015`; Sprint 1-7 preservation; immutable triggers; cash attribution; rule exclusion and derived balances                        |
| Integration   | Tenant/branch isolation, over-refund, original register, active tip version, adjustment posting, exact statement scope, timezone numbering and rule overlap |
| Concurrency   | Create/execute duplicate, payment/line balance race, cross-register no side effects, one adjustment entry, rule exclusion and period lock                   |
| Authorization | Role matrix, dual control, refund-window override, technician own scope, Accountant no cash payout and Platform denial                                      |
| E2E           | Cash attribution, tip version, manual adjustment, exact period statement, refund window and existing refund/commission journeys                             |
| UI/Mobile     | Loading, empty, error, retry, permission and conflict states; offline financial writes blocked                                                              |
| Regression    | Sprint 1-6 unit/integration/contract/E2E/build remain green                                                                                                 |

## Financial correctness closure suites

- Integration: `sprint7-cash-refund-register`, `sprint7-tip-version-integrity`, `sprint7-adjustment-posting`, `sprint7-period-statement-lock`, `sprint7-refund-window-numbering`, `sprint7-rule-overlap`.
- Authenticated deep E2E: cash attribution, tip refund, adjustment, exact period statement and refund window.
- CI resets and deterministically seeds PostgreSQL before every closure integration and deep E2E file.
