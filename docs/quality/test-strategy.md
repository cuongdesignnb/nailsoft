# Test strategy and deterministic data

- Unit: domain state machines/calculations and shared validation; fast, isolated Vitest projects.
- Integration: real PostgreSQL transactions, tenant scoping, migration rollback, outbox claim and optional Redis cache failure. Never mock isolation guarantees.
- E2E: Playwright starts the real API and Admin Web, authenticates through `/v1/auth/login`, uses PostgreSQL-backed CRUD, and verifies reload/API state, conflicts and authorization. No token injection or backend mock is allowed.
- Mobile API integration: Playwright exercises the same real session and API contracts used by Owner/Staff Mobile; offline queue receives integration tests in Sprint 6.

Fixtures use fixed UUIDs, `example.test` identities and a fixed July 2026 schedule. `pnpm db:reset` recreates 1 tenant, 2 branches, deterministic Owner/Manager A/Manager B/Receptionist/Technician A/Technician B/Platform accounts, 14 staff profiles, 6 categories, 30 services, 20 customers, 40 appointments, 10 products, 3 vouchers, 1 loyalty program and 2 commission rules. No real personal data is used.

CI gates every change on lint, strict typecheck, unit/integration/E2E tests and build. Integration tests use disposable PostgreSQL; all tests assert loading/error/permission contracts when UI work enters scope.
