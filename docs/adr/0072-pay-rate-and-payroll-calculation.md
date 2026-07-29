# ADR 0072: Pay rate and payroll calculation

Status: Accepted for Sprint 12.

Money uses PostgreSQL `bigint` minor units and TypeScript `bigint`. Hourly calculation is `round(seconds × rateMinor × numerator / 3600 / denominator)` with rational multipliers and explicit rounding. Effective pay-rate versions use a PostgreSQL exclusion constraint so active scope/date ranges cannot overlap. Payroll calculation snapshots the policy/rate version and source fingerprints.

Consequences: results are deterministic and reproducible without floating point. Tax is an approved input only; Sprint 12 does not calculate statutory tax.
