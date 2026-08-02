# ADR 0100 — Asset candidate and capitalization boundary

Procurement, Inventory and General Ledger remain authoritative. Sprint 16 records immutable source fingerprints and allocation amounts, then emits source-posting candidates; it never mutates source rows or inserts journals directly. A source generation is unique per tenant, source and generation.
