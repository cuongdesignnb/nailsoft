# Sprint 11 Test Matrix

| Layer       | Evidence                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | Consent reducer, state machines, token integrity, renderer, quiet hours/frequency, review eligibility, SLA                     |
| PostgreSQL  | 0021 up/down/up, append-only events, immutable versions/audience, default consent, tenant/branch FKs, unique generation/review |
| API         | Preferences, grant/withdraw, templates/rules, segments/campaign dual control, review verification, recovery/compensation       |
| Worker      | duplicate outbox, claim/retry/dead-letter, timezone reminder, send-time withdrawal, bounce/complaint suppression               |
| Concurrency | duplicate message generation, simultaneous unsubscribe/send, campaign approve, one low-rating case                             |
| Security    | cross-tenant/branch denial, Technician own assignment, Platform denial, redaction/token tamper                                 |
| E2E         | Customer consent/unsubscribe/review, Admin campaign/recovery, Owner approval, Staff recovery contact                           |
| Regression  | Full Sprint 1–10 unit/integration/contract/E2E/build pipeline                                                                  |

Exit evidence must reference the exact final commit and CI run. Local capacity fixtures are not production performance claims.
