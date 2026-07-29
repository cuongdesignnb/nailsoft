# Sprint 11 State Transition Matrix

## Consent

`NOT_GRANTED|UNKNOWN|WITHDRAWN -> GRANTED`; `GRANTED -> WITHDRAWN`; history is append-only. Marketing withdrawal atomically activates suppression.

## Message

`PENDING -> SCHEDULED|PROCESSING|SUPPRESSED|CANCELLED`; `SCHEDULED -> PROCESSING|SUPPRESSED|CANCELLED`; `PROCESSING -> SENT|FAILED|DEAD_LETTER|SUPPRESSED`; `SENT -> DELIVERED|BOUNCED|COMPLAINED`. Retry uses a bounded new attempt without deleting evidence.

## Campaign

`DRAFT -> PENDING_APPROVAL|CANCELLED`; `PENDING_APPROVAL -> APPROVED|CANCELLED`; `APPROVED -> SCHEDULED|CANCELLED`; `SCHEDULED -> RUNNING|CANCELLED`; `RUNNING -> PAUSED|COMPLETED|CANCELLED|FAILED`; `PAUSED -> RUNNING|CANCELLED`.

A scheduled campaign has not started delivery and cannot be paused. Pause is available only from `RUNNING`; resume is available only from `PAUSED` and returns the campaign to `RUNNING`.

Requester cannot approve. Audience generations are immutable.

## Review request/review

Request: `PENDING -> SENT|SUPPRESSED|CANCELLED`; `SENT -> SUBMITTED|EXPIRED|CANCELLED`. Review: `VERIFIED -> PUBLISHED|HIDDEN|FLAGGED|ARCHIVED`; moderation never alters the original revision.

## Recovery

`OPEN -> TRIAGED|CANCELLED`; `TRIAGED -> IN_PROGRESS|CANCELLED`; `IN_PROGRESS -> WAITING_CUSTOMER|RESOLVED|CANCELLED`; `WAITING_CUSTOMER -> IN_PROGRESS|RESOLVED|CANCELLED`; `RESOLVED -> CLOSED`. Pending compensation blocks resolution.

Compensation: `DRAFT -> PENDING_APPROVAL|CANCELLED`; `PENDING_APPROVAL -> APPROVED|REJECTED|CANCELLED`; approved proposals post only through the owning benefit/stored-value workflows.
