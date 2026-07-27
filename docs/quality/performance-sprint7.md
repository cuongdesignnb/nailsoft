# Sprint 7 performance plan

Targets: refund plan `<500 ms`, create `<500 ms`, cash execution `<700 ms`, external confirmation `<900 ms` excluding provider latency, credit-note detail `<350 ms`, commission period detail `<700 ms`, financial reports `<1 s`, realtime refetch signal `<1 s` at p95.

Capacity fixture: 100,000 invoices, 300,000 lines, 150,000 payments, 50,000 refunds, 500,000 commission entries and 1,000 staff. Local results are capacity evidence only, not production claims. Indexes target invoice/status, original payment, branch/date, staff/date, period/staff and unresolved conflict access paths.
