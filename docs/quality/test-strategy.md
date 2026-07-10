# Test strategy and deterministic data

- Unit: domain state machines/calculations and shared validation; fast, isolated Vitest projects.
- Integration: real PostgreSQL transactions, tenant scoping, migration rollback, outbox claim and optional Redis cache failure. Never mock isolation guarantees.
- E2E: Playwright for web/API skeleton now; critical SRS journeys are added with their sprint.
- Mobile E2E: add Maestro when executable flows begin; offline queue receives integration tests in Sprint 6.

Fixtures use fixed UUIDs, `example.test` identities and a fixed July 2026 schedule. `pnpm db:reset` recreates 1 tenant, 2 branches, 12 staff identities (owner, manager, 2 receptionists, 8 technicians), 6 categories, 30 services, 20 customers, 40 appointments, 10 products, 3 vouchers, 1 loyalty program and 2 commission rules. No real personal data is used.

CI gates every change on lint, strict typecheck, unit/integration/E2E tests and build. Integration tests use disposable PostgreSQL; all tests assert loading/error/permission contracts when UI work enters scope.
