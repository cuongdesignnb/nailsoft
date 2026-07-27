# ADR 0043: Service package entitlement ledger

Status: Accepted for Sprint 8.

A package product defines service/category/branch eligibility and unit cost. Issuance creates one entitlement and append-only ISSUE entry. The entitlement projection satisfies `available + reserved + consumed = granted + adjustment`. Booking and POS use the same locked reservation primitive; a unique active appointment-item reservation prevents duplicate coverage. Payment commits units, cancellation/expiry releases them, and qualified refunds append reversals. Monetary stored-value wallets are outside scope.
