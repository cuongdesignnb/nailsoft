# Realtime security — Sprint 3 closure

## Handshake and active authorization

The client sends only `auth.token`. The server ignores client-declared `tenantId`, `membershipId`, roles, branches and staff identity. JWT signature and expiry are necessary but not sufficient: the server reloads active session, membership authorization version, user, tenant, roles, branches and own staff profile from PostgreSQL.

Denial codes match HTTP authorization (`INVALID_ACCESS_TOKEN`, `SESSION_REVOKED`, `AUTHORIZATION_CHANGED`, `MEMBERSHIP_NOT_ACTIVE`, `USER_NOT_ACTIVE`, `TENANT_NOT_ACTIVE`, `TENANT_CONTEXT_MISMATCH`). Denials record structured security events without tokens, cookies or raw handshake headers.

## Room policy

| Role | Control rooms | Scheduling rooms |
|---|---|---|
| Owner | session, membership, user | tenant and every active tenant branch |
| Manager | session, membership, user | assigned active branches |
| Receptionist | session, membership, user | assigned active branches |
| Technician | session, membership, user | linked own staff only |
| Accountant / Marketing | session, membership, user | none |
| Platform Super Admin | none after denial | none without Support Access Grant |

Control rooms carry only revocation/authorization signals. Business invalidations contain no customer PII, notes, credentials or entity snapshot.

## Revocation and origins

Session revoke, logout-all, membership suspend/revoke, user suspend/disable and authorization changes are durable outbox events. Worker publishes a validated Redis control message; each API node matches its local socket authorization context, emits a neutral revocation signal and disconnects. Token expiry has an independent server timer.

Both HTTP and Socket.IO use the trimmed `CORS_ORIGINS` allowlist. Unknown origins fail Engine.IO admission. Production rejects missing configuration and wildcard-plus-credentials.
