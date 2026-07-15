# ADR 0023 — Deterministic booking resource allocation

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

For every service resource requirement, the planner selects active resources in the appointment branch after maintenance/busy-block and effective reservation checks. Candidates sort by remaining capacity descending and resource ID ascending.

Exclusive requirements allocate quantity one across distinct resources and cannot overlap any active allocation. Shared requirements may span resources, but the transaction holds tenant-scoped resource advisory locks in sorted ID order and validates the total active overlapping quantity against persisted capacity immediately before insert.

Any unsatisfied requirement aborts the complete sequential plan with `RESOURCE_CAPACITY_INSUFFICIENT`. No role may override staff overlap, resource capacity, inactive branch, business hours, shift or skill constraints.

## Consequences

- Repeated planning against the same database state produces the same concrete allocation.
- Concurrency cannot exceed resource capacity.
- Allocation records remain explicit and auditable for later service execution.
