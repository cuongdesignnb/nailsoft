# Sprint 8 test matrix

| Risk | Evidence |
| --- | --- |
| Benefit order and integer rounding | `sprint8-benefit-domain.test.ts` |
| Voucher normalization/HMAC and DST expiry | unit domain suite |
| Migration, composite FKs and deterministic seed | `sprint8-benefit-invariants.test.ts` |
| 20-way voucher/loyalty/package contention | PostgreSQL invariant suite |
| Membership effective overlap | PostgreSQL exclusion test |
| Append-only ledgers | PostgreSQL trigger tests |
| Wallet redaction and platform denial | authenticated Sprint 8 E2E |
| Loyalty dual control | authenticated Sprint 8 E2E |
| Owner/Staff/Booking Mobile contracts | `sprint8-mobile-smoke.test.ts` |
| Prior sprint regression | existing unit, integration, contract and E2E lanes remain enabled |
| Load smoke | wallet, campaign, liability and expiry scenarios |
| Loyalty tip boundary and exact redemption contract | `sprint8-loyalty-tip-boundary.test.ts` |
| Server package units and multi-line applications | `sprint8-package-units-multiline.test.ts` |
| Refund-before-settlement and proportional earn reversal | `sprint8-loyalty-refund-settlement.test.ts` |
| Rolling membership, refund downgrade and manual protection | `sprint8-membership-metrics-downgrade.test.ts` |
| Active appointment package beyond scheduled end | `sprint8-package-appointment-lifecycle.test.ts` |
| Voucher customer concurrency/net use and fixed currency | `sprint8-voucher-customer-limit.test.ts`, `sprint8-voucher-currency.test.ts` |
| Reserved lot expiry safety | `sprint8-loyalty-lot-expiry.test.ts` |
| Immutable line/application refund allocation | `sprint8-benefit-refund-allocation.test.ts` |
| Per-job transaction, retry and dead letter | `sprint8-worker-isolation.test.ts` |
| Paid/refunded authenticated closure lifecycles | five `sprint8-*-paid-*`/closure E2E specs |

Migration QA runs fresh up through `0017`, rollback to `0016` and re-up. Each stateful closure spec receives a reset deterministic fixture. Commands additionally require service-level idempotency, version checks, audit/outbox and domain-error mapping.
