# Sprint 6 test matrix

| Layer         | Required evidence                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | Bigint money, exclusive/inclusive tax, rounding, discount/tip remainder, state machines, sensitive request rejection                      |
| PostgreSQL    | 0012 up/down/up, active order/session uniqueness, immutable invoice/payment, append-only evidence, provider reference and invoice counter |
| API           | Appointment import, discount approval, tip, finalize, cash/external/split payment, zero total, receipt, cash close, reconciliation        |
| Concurrency   | 20 order creates, 20 final payments, provider reference, 100 counters, drawer open, cash close/payment, discount/payment                  |
| Authorization | Cashier branch/own session, Reception denied capture, Accountant read-only, Technician/Marketing/Platform denied, cross-tenant opaque     |
| E2E           | Cash checkout, split tender, manager approval, concurrent settlement and immutable receipt                                                |
| UI/mobile     | Cashier touch workflow, loading/empty/error/retry/permission/version/offline/success; Owner read-only summary                             |
| Performance   | Local smoke clearly separated from production-like release benchmark                                                                      |
