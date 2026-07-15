# ADR 0017: Shared HTTP and WebSocket session authorization

## Status

Accepted for Sprint 3 closure.

## Decision

HTTP and `/scheduling` WebSocket connections call the same `SessionAuthorizationService`. The service verifies the signed access token, then treats PostgreSQL as authoritative for device-session state, membership state and authorization version, user and tenant status, roles, branch scope, and the membership-linked staff profile. Roles, branches, tenant, membership and `staffId` supplied by a socket client are ignored.

Every accepted socket joins control rooms for its session, membership and user. Business rooms are server-derived: Owner receives tenant plus active branches; Manager and Receptionist receive assigned active branches; Technician receives only their own staff room; Accountant and Marketing receive none; Platform Super Admin is denied until a Support Access Grant capability exists.

Sockets expire with the access token. Security mutations are transactional outbox events delivered through a dedicated Redis control channel, so every API node disconnects matching local sockets. Reconnect always repeats full authorization.

HTTP and Socket.IO use one explicit origin allowlist. Production fails fast when `CORS_ORIGINS` is absent or contains a wildcard while credentials are enabled. Engine.IO `allowRequest` rejects unknown origins server-side; missing Origin remains supported for native clients.

## Consequences

- A stale JWT cannot preserve revoked roles or branch scope.
- No salon data is sent through control rooms.
- Redis accelerates multi-node disconnect but PostgreSQL remains the authorization source.
- A Redis outage delays event-driven disconnect; HTTP and every reconnect still fail closed from PostgreSQL.
