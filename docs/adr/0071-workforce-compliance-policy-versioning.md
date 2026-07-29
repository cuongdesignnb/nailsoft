# ADR 0071: Workforce compliance policy versioning

Status: Accepted for Sprint 12.

No wage, overtime, break, tax or classification law is hardcoded. Tenant policies contain optional jurisdiction metadata, effective dates, rule JSON, a fingerprint and legal-review state. Production payroll requires an active `APPROVED` legal-review version and otherwise returns `PAYROLL_POLICY_NOT_ACTIVATED`. Violations and waivers retain the exact policy version and evidence.

Consequences: deployment is jurisdiction-neutral and fail closed; a qualified legal/product review is an operational prerequisite, not a software assumption.
