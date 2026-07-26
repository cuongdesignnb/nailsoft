# Sprint 5 operations API draft

All write commands require bearer authentication, granular permission, tenant and branch scope, `Idempotency-Key`, and return the standard API envelope. Versioned commands return `409` on stale state. Realtime payloads are privacy-safe refetch signals.

## Resources

- Walk-ins: `GET/POST /v1/walk-ins`, detail/update, state commands, priority, conversion plans/holds/convert, queue summary.
- Arrival: appointment arrive, check-in, revert-check-in, and arrival detail.
- Sessions: list/detail and start/pause/resume/complete/cancel/transfer-staff.
- Extensions: add-service plan/hold/commit.
- Notes/media: session note CRUD and presign/complete/list/delete metadata.
- Operations: board, summary, staff today, and checkout summary.

The canonical schemas and error responses are maintained in `docs/api/openapi.yaml` and shared Zod schemas in `@nailsoft/validation`.
