# ADR 0037 — Commission period locking

- Status: Accepted for Sprint 7
- Date: 2026-07-27

## Decision

Commission periods are tenant-scoped, non-overlapping and follow `OPEN → REVIEW → LOCKED`; review may return to open, but a locked period is terminal. Lock acquires the period row, rejects unresolved generation conflicts, assigns eligible entries, calculates per-staff immutable snapshots, and stores both detail hashes and a period integrity hash in one transaction.

No late entry may be inserted into a locked period. Later corrections post to an open period while referencing the locked source period.

## Consequences

Concurrent locks converge on one version and one snapshot. Locked evidence is suitable for payroll export in a later sprint, but Sprint 7 does not implement payroll payout.
