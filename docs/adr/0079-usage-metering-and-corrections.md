# ADR 0079: Usage metering and corrections

Status: Accepted. Events have a tenant/meter/source fingerprint. Replay cannot increase aggregates twice. Workers aggregate with `FOR UPDATE SKIP LOCKED`. Finalized usage is immutable; corrections append evidence and apply next period or by credit note. Aggregates remain rebuildable from PostgreSQL events and corrections.
