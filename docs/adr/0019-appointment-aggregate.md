# ADR 0019 — Appointment aggregate and lifecycle

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

`Appointment` is the booking aggregate root. It owns ordered service items, one active primary staff assignment per item, concrete resource allocations, immutable service/price/tax snapshots, contact and policy snapshots, status history and schedule revisions.

Sprint 4 implements `DRAFT`, `PENDING_CONFIRMATION`, `PENDING_DEPOSIT`, `CONFIRMED`, `EXPIRED`, `CANCELLED_BY_CUSTOMER` and `CANCELLED_BY_SALON`. Check-in, execution, completion and no-show commands remain unavailable. Reschedule is an atomic command: a successful reschedule keeps the current status `CONFIRMED`, increments `schedule_version`, writes a revision and emits `appointment.rescheduled`. The SRS vocabulary value `RESCHEDULED` is therefore historical/event terminology, not a stable Sprint 4 aggregate state.

All mutations use explicit commands, optimistic `version`, tenant/branch authorization, audit and transactional outbox. Appointments are never hard deleted.

## Consequences

- A multi-service appointment is sequential; each item may use a different qualified staff member.
- Time-only reschedule preserves confirmed price and policy snapshots.
- Client code cannot derive or directly patch aggregate/item status.
- Later service-execution states may extend the aggregate without changing Sprint 4 commands.
