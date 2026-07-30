# ADR 0077: Subscription periods and proration

Status: Accepted. Every period stores UTC bounds, billing timezone, plan/price, quantity, entitlement, quota, meter, discount and tax snapshots plus a fingerprint. Immediate proration uses signed bigint rational arithmetic with half-up rounding. Negative results append account credit; they never rewrite an invoice. Downgrades default to next period.
