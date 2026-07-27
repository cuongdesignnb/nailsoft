# Sprint 7 test matrix

| Layer         | Required evidence                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | refund and period state machines; deterministic proration; rule precedence; commission rounding; locked-period routing                      |
| Migration     | fresh up; `0014 → 0013 → 0014`; Sprint 1–6 preservation; immutable triggers; derived balances                                               |
| Integration   | tenant/branch isolation; over-refund; original tender; credit numbering; tip/commission append-only                                         |
| Concurrency   | create/execute duplicate; payment/line balance race; cash drawer race; credit counter; invoice generation; period lock; adjustment approval |
| Authorization | role matrix, dual control, technician own scope, Accountant no cash payout, Platform denial                                                 |
| E2E           | cash refund; external/manual evidence; partial/full refund; failed/unknown recovery; period lock; post-lock adjustment                      |
| UI/Mobile     | all loading, empty, error, retry, permission and conflict states; offline financial writes blocked                                          |
| Regression    | Sprint 1–6 unit/integration/contract/E2E/build remain green                                                                                 |
