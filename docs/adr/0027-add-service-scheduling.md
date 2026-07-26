# ADR 0027: Add-service scheduling

- Status: Accepted for Sprint 5
- Date: 2026-07-26

## Decision

An in-salon add-service follows plan, hold, and commit. Planning uses the existing Booking Planner and returns price snapshots and schedule impact without reserving. Holding uses the existing Slot Hold/Reservation Engine. Commit locks the appointment, validates version and approval metadata, consumes the hold through the booking boundary, appends a new appointment item and `PENDING` service session, increments schedule version, and records a schedule revision.

Existing item service/price/policy snapshots are immutable. Add-on relationships are validated against the catalog. Staff/resource conflicts are hard conflicts and cannot be overridden.

## Consequences

- No silent repricing of existing items.
- Add-service cannot bypass availability or reservation locking.
- A failed revalidation returns `ADD_SERVICE_NOT_AVAILABLE` and does not partially mutate the appointment.
