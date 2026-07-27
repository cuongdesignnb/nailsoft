# ADR 0042: Membership tier evaluation

Status: Accepted for Sprint 8.

Tiers are versioned effective records. Customer assignments store qualification and benefit snapshots and use a PostgreSQL exclusion constraint to prohibit overlapping active ranges. Paid orders update tenant-scoped metrics and enqueue idempotent evaluation jobs. Evaluation selects the highest-priority qualifying active tier; changes append a new assignment and supersede the old one. Historical invoices retain the applied snapshot.
