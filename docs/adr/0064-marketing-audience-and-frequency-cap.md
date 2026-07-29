# ADR 0064 — Marketing Audience and Frequency Cap

Status: Accepted for Sprint 11.

## Decision

Segments compile from an allowlisted JSON filter model; arbitrary SQL is rejected. Branch-scoped actors cannot create tenant-wide audiences. Approval is dual-control. Each campaign run stores an immutable audience generation with consent evidence and redacted contact reference.

The Worker rechecks consent, contact status, suppression, campaign state and customer-local quiet hours immediately before send. Frequency capacity is reserved atomically in PostgreSQL with an expiring lease; combined sent messages and active reservations cannot exceed the configured cap. A snapshot establishes audit history, not permanent eligibility.

## Consequences

Audience rebuilds create new generations. Suppressed recipients remain as terminal evidence and are never silently removed. Snapshotting fails with `CAMPAIGN_AUDIENCE_LIMIT_EXCEEDED` when the explicit tenant limit would be exceeded; recipients are never silently truncated. Only filters with implemented SQL semantics are accepted.
