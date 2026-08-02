# Sprint 16 Assets API draft

The functional API is rooted at `/v1/assets` and uses explicit commands only. Mutating commands require `Idempotency-Key`, authenticated tenant/branch scope, current `version` where applicable, audit and outbox evidence. Configuration, candidates, capitalization, depreciation, maintenance, warranty, transfer, count, inspection, impairment, improvement, disposal, opening-import and report routes are implemented in `apps/api/src/modules/assets/assets.controller.ts`.
