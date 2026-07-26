# ADR 0026: Staff contribution segments

- Status: Accepted for Sprint 5
- Date: 2026-07-26

## Decision

Actual staff contribution is append-only history in `service_session_staff_segments`. Starting/resuming opens a segment; pause, transfer, completion, or cancellation closes it with a reason. A session can have only one open PRIMARY segment, and a staff member can have only one open segment across service sessions in a tenant.

Transfer is atomic: validate target branch assignment and skill, ensure the target is not executing another session, revalidate the remaining reservation window, then close the old segment and update the planned primary assignment/reservation before opening the target segment. If validation or reservation fails, the old staff assignment remains unchanged.

## Consequences

- Future commission logic can aggregate actual seconds without guessing from the final assignee.
- Pause time is represented separately and excluded from contribution duration.
- Concurrent starts/transfers map database constraint errors to domain conflicts.
