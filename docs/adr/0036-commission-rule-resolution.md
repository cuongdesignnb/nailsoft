# ADR 0036 — Commission rule resolution and contribution evidence

- Status: Accepted for Sprint 7
- Date: 2026-07-27

## Decision

Commission is generated from an issued invoice line and completed service staff segments, never from mutable catalog prices or current staff assignment. Rule precedence is deterministic: staff + service + branch specificity, then explicit priority, then stable rule ID. Rules are effective-dated and are superseded rather than edited after use.

Percentage rules use integer minor units and basis points; fixed rules use fixed minor units. The selected rule, base, contribution work seconds and source IDs are snapshotted in an append-only entry. A stable generation key makes invoice generation exactly-once. Missing contribution or rule evidence produces an unresolved conflict instead of guessing.

## Consequences

Staff transfers preserve proportional contribution. Historical earnings do not change when a rule or catalog changes. Conflicts block period locking until resolved or explicitly waived with audit evidence.
