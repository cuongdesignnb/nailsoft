# Sprint 6 test matrix

| Layer         | Required evidence                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | Bigint money, exclusive/inclusive tax, rounding, discount/tip remainder, state machines, sensitive request rejection                  |
| PostgreSQL    | 0012 plus 0013 up/down/up, immutable register attribution, composite order/session/payment register constraints, append-only evidence |
| API           | Auth-session device binding, register assignment, cross-register denial, blind close/review, exact register/cashier reconciliation    |
| Concurrency   | First-cash-session race, same-session split, final payment, provider reference, drawer open, cash close/payment, discount/payment     |
| Authorization | Cashier branch/own session, Reception denied capture, Accountant read-only, Technician/Marketing/Platform denied, cross-tenant opaque |
| E2E           | Bound/spoofed device, cross-register denial, blind close, cash/card/bank reconciliation and immutable receipt                         |
| UI/mobile     | Cashier touch workflow, loading/empty/error/retry/permission/version/offline/success; Owner read-only summary                         |
| Performance   | Local smoke clearly separated from production-like release benchmark                                                                  |
