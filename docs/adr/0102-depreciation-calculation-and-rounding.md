# ADR 0102 — Decimal-safe depreciation

Money uses bigint minor units. Straight-line schedules use integer division with the final period absorbing remainder; declining-balance and units-of-production retain rational parameters. Cumulative depreciation is capped at gross cost minus residual value and is deterministic for a given asset/policy/period fingerprint.
