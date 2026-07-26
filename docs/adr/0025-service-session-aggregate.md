# ADR 0025: Service session aggregate

- Status: Accepted for Sprint 5
- Date: 2026-07-26

## Decision

`appointment_items` remain immutable booking snapshots. Actual work is recorded in a separate `service_sessions` aggregate with command-specific transitions: start, pause, resume, complete, cancel, and transfer-staff. Each command locks the appointment and session in a stable order, checks optimistic version, records audit/outbox in the same transaction, and derives appointment operational status on the server.

Sessions are created idempotently in `PENDING` when check-in succeeds. Appointment status is derived after every session transition: active/paused wins `IN_SERVICE`; all active items completed wins `COMPLETED`; any completed item wins `PARTIALLY_COMPLETED`; otherwise an arrived appointment remains `CHECKED_IN`.

`checkout_ready` is true only when all active items are completed or cancelled and at least one is completed. This produces a pricing preview only; no invoice, tax finalization, tip, payment, refund, inventory, or commission is created.

## Consequences

- Booking snapshots are not rewritten with actual execution data.
- Database partial unique indexes prevent multiple open primary segments and pauses.
- Terminal sessions cannot be restarted; rework requires a later change request.
