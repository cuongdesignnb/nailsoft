# Sprint 19 Screen Acceptance Ledger

Current phase: Wave 0 remediation in progress
Evidence root: `artifacts/sprint19/screens/<SCREEN_ID>/`

## Acceptance contract

An acceptance row is complete only when route, persona, permission, tenant and branch scope, API contract, all required UI states, responsive matrix, accessibility record, locale record, evidence paths and exact source/CI result are present. A screenshot is not evidence until it has a deterministic viewport, data seed and SHA-256 path record.

## Wave 0 rows

| ID | Route | Persona | Permission and branch scope | API | Required states | Responsive and accessibility | Locale | Evidence | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.0.1 | Documentation | Delivery | N/A | N/A | Ready | N/A | vi-VN/en-US parity | Pending | Pending | Pending | In progress |
| 19.0.2 | Documentation | All personas | N/A | N/A | Ready | Role matrix review | vi-VN/en-US parity | Pending | Pending | Pending | In progress |
| 19.0.3 | Shared package | All authenticated users | Presentation only | N/A | Ready | Token unit tests | vi-VN/en-US parity | Pending | Pending | Pending | In progress |
| 19.0.4 | Shared package | All authenticated users | Presentation only | N/A | Ready | Typography and formatter tests | vi-VN/en-US parity | Pending | Pending | Pending | In progress |
| 19.0.5 | Gallery | All roles | Existing granular permissions | Existing APIs | Loading, ready, error, validation | Keyboard and 200 percent zoom | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.6 | Gallery | All roles | Existing granular permissions | Existing APIs | Ready, disabled, forbidden | Keyboard and touch target | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.7 | Gallery | All roles | Existing granular permissions | Existing APIs | Empty, ready, error, responsive list | Table headers and narrow viewport | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.8 | Gallery | All roles | Existing granular permissions | Existing APIs | Dialog, drawer, toast, banner | Focus trap and Escape | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.9 | Gallery | All roles | Existing granular permissions | Existing APIs | Loading, empty, retry, forbidden, stale, offline, partial | Axe and keyboard | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.10 | Gallery | Owner, Manager, Accountant | Existing analytics permissions | Existing analytics APIs | Chart ready, no data, loading, table fallback | Accessible table headers and currency | vi-VN/en-US | Pending | Pending | Pending | In progress |
| 19.0.11 | `/admin/design-system` | Developer/test operator | Gallery config; tenant context from server | `/v1/auth/context` | Full gallery and locale switch | 1440, 1280, 1024, 768, 390, 360; axe; keyboard | vi-VN and en-US screenshots | `gallery-desktop-ready.png` SHA256 `D7DC21...`; `gallery-skip-link-focus.png` SHA256 `C7F9C0...`; locale and six viewport files | Working tree QA commit pending | Targeted E2E 3/3 PASS | Ready for review |
| 19.0.12 | `/admin/**` | Role adaptive | Server effective permissions and branch scope | `/v1/auth/context` | Loading, ready, forbidden, retry | Shell viewport and focus order | vi-VN/en-US | `gallery-desktop-ready.png` and responsive shell evidence | Working tree QA commit pending | Targeted E2E 3/3 PASS | Ready for review |
| 19.0.13 | Mobile root and tabs | Owner, Technician | Server effective permissions and own staff scope | `/v1/auth/context` | Loading, ready, forbidden, offline | Safe area, mobile touch targets | vi-VN/en-US | Pending | Pending | Pending | In progress |

Business rows are appended one screen at a time after Wave 0 acceptance. No business row is accepted by this checkpoint.
