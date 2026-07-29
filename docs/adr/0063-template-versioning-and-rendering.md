# ADR 0063 — Template Versioning and Rendering

Status: Accepted for Sprint 11.

## Decision

Template identity and template content versions are separate. Content fields of a version are database-immutable; lifecycle status and effective dates may change. Rendering accepts only declared variables, requires every mandatory variable, HTML-escapes substituted values and strips unsafe markup before persistence.

Marketing templates require a compliance footer and unsubscribe URL. Historical messages reference the exact version and keep rendered snapshots.

## Consequences

Editing active content creates a new version. Old deliveries remain auditable and reproducible.
