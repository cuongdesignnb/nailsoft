# Nailsoft

Multi-tenant nail salon management platform implemented as a modular monolith. PostgreSQL is the system of record; Redis is used only for disposable cache, rate limits and realtime fan-out.

## Local setup

1. Copy `.env.example` to `.env`.
2. Run `docker compose up -d`.
3. Run `pnpm install`.
4. Run `pnpm db:migrate && pnpm db:seed`.
5. Run `pnpm dev`.

Services: admin web `3000`, API `3001`, booking web `3002`, PostgreSQL `5432`, Redis `6379`. Start mobile apps separately with `pnpm --filter @nailsoft/owner-mobile dev` or `pnpm --filter @nailsoft/staff-mobile dev`.

Quality gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Database reset is deterministic: `pnpm db:reset`. Roll back the latest migration with `pnpm db:rollback`.
