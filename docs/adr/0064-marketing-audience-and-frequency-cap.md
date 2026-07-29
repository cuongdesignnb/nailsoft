# ADR 0064 — Marketing Audience and Frequency Cap

Status: Accepted for Sprint 11.

## Decision

Segments compile from an allowlisted JSON filter model; arbitrary SQL is rejected. Branch-scoped actors cannot create tenant-wide audiences. Approval is dual-control. Each campaign run stores an immutable audience generation with consent evidence and redacted contact reference.

The Worker rechecks consent, contact status, suppression, frequency cap and customer-local quiet hours immediately before send. A snapshot establishes audit history, not permanent eligibility.

## Consequences

Audience rebuilds create new generations. Suppressed recipients remain as `SKIPPED` evidence and are never silently removed.
