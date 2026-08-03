# Disaster Recovery Plan

Declare an incident, freeze risky writes, identify the last valid backup, and provision an isolated restore target. Verify schema head, counts and financial/tenant invariants before directing traffic. Promote only after the incident commander confirms RPO/RTO evidence and reconciliation. Redis is recreated from PostgreSQL/outbox state; it is never promoted as source of truth.
