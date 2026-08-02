# ADR 0101 — Fixed asset register and policy versioning

Assets are tenant/branch scoped and economic fields become immutable once activated. Category and depreciation policies are versioned with effective dates and fingerprints. A policy change affects future schedules only; historical posted schedules are not rewritten.
