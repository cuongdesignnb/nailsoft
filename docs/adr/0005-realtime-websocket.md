# ADR 0005: Realtime/WebSocket

- Status: Accepted
- Decision: Authenticated sockets join tenant and authorized branch rooms. Outbox-derived events carry event id, aggregate version and occurred time. Clients invalidate/refetch authoritative API data on reconnect or version gaps.
- Consequences: Optimistic UI rolls back on rejection. WebSocket state is never authoritative; Redis may fan out across processes but event recovery comes from PostgreSQL/API.
