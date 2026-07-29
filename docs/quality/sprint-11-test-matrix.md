# Sprint 11 Test Matrix

| Layer       | Evidence                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Consent reducer, state machines, token integrity, renderer, quiet hours/frequency, review eligibility and SLA               |
| PostgreSQL  | 0021 + 0022 up/down/up, immutable ledgers/audience, leased claims/reservations, counters and compensation sync triggers     |
| API         | Headerless unsubscribe, narrow segment contract, audience limit, global/branch scope and compensation lifecycle            |
| Worker      | Pause/cancel gating, pre-provider revalidation, crash recovery, 24h review delay and replay-safe campaign finalization      |
| Concurrency | 20-way frequency cap, withdrawal-after-claim, expired lease, finalizer replay and owning-domain compensation sync           |
| Security    | Cross-tenant/branch/global denial, purpose-specific withdrawal, Technician own assignment, Platform denial and token privacy |
| E2E         | Public unsubscribe; campaign lifecycle; review withdrawal/submit; recovery credit, loyalty and voucher posting             |
| Regression  | Full Sprint 1–11 unit/integration/contract/authenticated E2E/build pipeline                                                  |

Exit evidence must reference the exact final commit and CI run. Local capacity fixtures are not production performance claims.
