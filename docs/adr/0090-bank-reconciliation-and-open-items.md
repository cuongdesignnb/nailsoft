# ADR-0090 Bank reconciliation and open items

Status: Accepted. Statement imports are fingerprint-deduplicated. Open-item allocation is lock-safe and capped at the original amount. Reconciliation matches and adjustments are auditable and do not mutate source journals.
