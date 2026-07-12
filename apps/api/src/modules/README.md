# Backend module boundaries

Each module owns its application, domain and infrastructure code. Cross-module calls use explicit public contracts; durable side effects use outbox events. Approved read-model modules may query authoritative tables through documented contracts and must not mutate them. Business modules are activated in backlog order.

Sprint 3 separates `AvailabilityModule` (authoritative calculation), `CalendarModule` (normalized read model), and `BusyBlockModule` (audited writes). None creates or mutates appointments or bookings.
