# ADR 0029 — Money, tax and deterministic rounding

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

All authoritative amounts are PostgreSQL `bigint` minor units and TypeScript `bigint` during calculation. No binary floating-point amount is summed or persisted. Percentage values are integer basis points.

The pricing order is gross → line discount → deterministic pro-rata order discount → taxable base → tax → total → non-taxable tip. Exclusive tax is `round(taxable × rate / 10000)`. Inclusive tax extracts the base as `round(inclusive × 10000 / (10000 + rate))`, then tax is the exact difference. Both `HALF_UP` and `HALF_EVEN` are implemented with integer quotient/remainder arithmetic.

Remainder minor units are assigned by fractional remainder descending and stable identifier ascending. Currency mixing returns `POS_ORDER_CURRENCY_MISMATCH`; FX is out of scope.
