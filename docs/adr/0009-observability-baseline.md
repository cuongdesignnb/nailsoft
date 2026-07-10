# ADR 0009: Observability baseline

- Status: Accepted by CR-0001
- Decision: Sprint 1 provides structured redacted logs, request/correlation IDs, error tracking, API/database latency, API errors, health/readiness, worker status, queue backlog, WebSocket connection count and authentication/security events.
- Evolution: Booking/payment add conflict, expiry, success/failure, retry, idempotency, outbox/consumer lag and realtime latency. Production adds OpenTelemetry, alerting, SLOs, crash/release correlation and synthetic login/booking checks.
- Privacy: Never log passwords, access/refresh/reset/invitation tokens, raw card data or unnecessary sensitive customer content.
