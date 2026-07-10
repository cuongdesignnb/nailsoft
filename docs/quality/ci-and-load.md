# Sprint 1 CI and load smoke

CI can run on push, pull request or `workflow_dispatch`, uses concurrency cancellation, PostgreSQL 16 and Redis 7, and declares test-only secrets explicitly. The mandatory job runs frozen install, lint, strict typecheck, fresh migration, deterministic seed, unit, integration, OpenAPI contract, Admin Web E2E, then builds API, Worker, Admin Web, Booking Web, Owner Mobile and Staff Mobile.

Run locally:

```text
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:reset
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
```

Load smoke uses `scripts/load-smoke.mjs`; it never contains production credentials. Defaults are warm-up 15 seconds, duration 60 seconds and concurrency 10, with a second run at concurrency 25. It reports request count, throughput, p50/p95/p99, errors and timeouts. CPU/RAM and PostgreSQL pool usage must be captured beside the report from the local/CI runtime. Acceptance is: no application 5xx, error rate below 0.5%, health/readiness p95 below 200 ms, branch read below 500 ms, refresh below 700 ms and login below 1,500 ms.

Local baseline captured 2026-07-11: health p95 2.51 ms (concurrency 10), readiness p95 2.75 ms (10), login p95 159.46 ms (10), workspace-selection p95 3.92 ms (10), refresh p95 45.96 ms (10) and 128.40 ms (25), branch read p95 19.48 ms (25). All captured scenarios reported 0% error and 0 timeouts; the complete runner also exercised both concurrency levels for every scenario.
