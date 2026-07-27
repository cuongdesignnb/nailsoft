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

Migration QA runs fresh up, rollback to 0015 and re-up. Commands additionally require service-level idempotency, version checks, audit/outbox and domain-error mapping.
