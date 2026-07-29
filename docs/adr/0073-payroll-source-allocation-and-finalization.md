# ADR 0073: Payroll source allocation and finalization

Status: Accepted for Sprint 12.

Each source is claimed by `(tenant, sourceType, sourceId, earningUsageKey)`. Locked timesheets, locked commission entries, settled tip allocations and approved adjustments are the only eligible inputs. Approval records source fingerprints. Finalization revalidates the fingerprint and blocking exceptions, consumes allocations, creates immutable statements/snapshots and emits audit/outbox in one transaction.

Consequences: a source amount cannot be paid twice. Finalized results and lines are protected by database triggers; changes use off-cycle/supplemental correction with linked statements.
