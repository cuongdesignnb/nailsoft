# ADR 0044: Benefit refund reversal

Status: Accepted for Sprint 8.

Refund completion calls the benefit reversal boundary in the same PostgreSQL transaction as financial corrections. Full refunds restore loyalty redemption and package units when the captured policy allows it; voucher uses follow their campaign snapshot. Partial or manual-review package cases create a unique `benefit_reversal_conflicts` record. Loyalty earned on refunded value is reversed with a compensating entry. Replays are harmless through generation keys and unique refund/source constraints.
