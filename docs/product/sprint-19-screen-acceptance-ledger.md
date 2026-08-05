# Sprint 19 Screen Acceptance Ledger

Current phase: Wave 1 accepted against source CI; Wave 2 not authorized
Evidence root: `artifacts/sprint19/screens/<SCREEN_ID>/`

## Acceptance contract

An acceptance row is complete only when route, persona, permission, tenant and
branch scope, API contract, required UI states, responsive matrix,
accessibility record, locale record, evidence paths and exact source/CI result
are present. A screenshot is not evidence until it has a deterministic
viewport, data seed and SHA-256 path record.

All Wave 0 rows below were accepted against source commit
`0a6afb5df93a162ffdf1ff864f07a3b44f696f02` and full CI run
`30892119845` (`SUCCESS`).

## Wave 0 rows

| ID | Route / surface | Persona | Permission and scope | API / evidence | Required states and QA | Locale | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.0.1 | Documentation / screen inventory | Delivery | N/A | `docs/product/sprint-19-screen-inventory.md` | Route inventory and acceptance contract | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.2 | Documentation / role usability matrix | All personas | Existing granular permissions | `docs/design/sprint-19-role-usability-matrix.md` | Role, scope and privacy review | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.3 | Shared semantic design tokens | All authenticated users | Presentation only | `docs/design/sprint-19-design-system.md` | Colors, spacing, typography, radius, shadow, status semantics | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.4 | Shared typography and formatters | All authenticated users | Presentation only | `apps/admin-web/app/styles.css`; font runtime check | Typography weights, Vietnamese glyphs, deterministic renderer | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.5 | Forms and validation gallery | All roles | Existing granular permissions | `/admin/design-system`; gallery E2E | Loading, ready, validation, error, keyboard, 200% zoom | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.6 | Buttons and actions gallery | All roles | Existing granular permissions | `/admin/design-system`; gallery E2E | Primary, secondary, destructive, disabled, loading, forbidden, touch targets | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.7 | Tables and responsive lists | All roles | Existing granular permissions | `/admin/design-system`; responsive evidence | Ready, empty, error, table headers, narrow viewport, pagination | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.8 | Modal, drawer, toast and banner | All roles | Existing granular permissions | `/admin/design-system`; accessibility E2E | Dialog, drawer, toast, banner, focus trap, Escape, focus return | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.9 | Async and permission states | All roles | Existing granular permissions | `/admin/design-system`; state gallery | Loading, empty, error, retry, forbidden, stale, offline, partial, axe, keyboard | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.10 | Charts and table fallback | Owner, Manager, Accountant | Existing analytics permissions | `/admin/design-system`; chart fallback | Ready, no data, loading, accessible table fallback, localized currency | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.11 | `/admin/design-system` component gallery | Developer and test operator | Gallery development/test configuration; tenant context from server | `artifacts/sprint19/screens/19.0.11/`; visual job `91936400486` | Full gallery, 6 viewports, axe 0, skip-link focus, deterministic visual | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.12 | `/admin/**` Admin Shell | Role adaptive | Server effective permissions and branch scope | `/v1/auth/context`; shell visual and responsive evidence | Permission navigation, tenant/branch context, scroll, drawer, focus order, loading, ready, forbidden, retry | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |
| 19.0.13 | Owner and Staff Mobile root/tabs | Owner, Technician | Server effective permissions and own staff scope | `tests/mobile/sprint19-wave0-mobile-shell.test.ts`; quality step 56 | Owner/Staff smoke, loading, ready, forbidden, offline policy, safe area, touch targets, role navigation, session context | vi-VN/en-US | `0a6afb5df93a162ffdf1ff864f07a3b44f696f02` | `30892119845 / SUCCESS` | ACCEPTED |

## 19.0.11 visual evidence manifest

| File | SHA-256 |
| --- | --- |
| `gallery-desktop-ready.png` | `DBE9FD7F0A648EA194E34EC50F6192EF88F3175A28895E4DC26BEBB34C2F9589` |
| `gallery-skip-link-focus.png` | `8B6A3931B9CA716996A5BBA39B20252B2DD3A8CCB4F85734A644ABB237D68EAF` |
| `gallery-desktop-vi-VN.png` | `9BDBF4056991DB22ED0D5BFCF8F063997E78B01FCF9D7A781EBF35B43AD2D795` |
| `gallery-desktop-en-US.png` | `211ACF6333929A47AFFD7B2EF69740517CE48913BB34E65F8642C0AAD57EB448` |
| `desktop-1440-vi.png` | `369291230BB2703E9ACCDE1A1B6E0EC49AC49E7E2486F2844AB2E29938DB826A` |
| `desktop-1280-vi.png` | `9600A2591CA60E6ACC036907E37AC11179200FF4D485284DC4F689E463A5EDCC` |
| `tablet-1024-vi.png` | `C355C6D5AF85A469BFDBD97940122B80E5709C26573FEE42B5ACA9CA37B01C3D` |
| `tablet-768-vi.png` | `BAE57CCBF6752C7AC5199597FD9E15706F014108FC4B5CD0B065DD6D40592066` |
| `mobile-390-vi.png` | `11EB7986EED2CF4C15D02A4762856B8491930F4978391B9F99A25784FF3E84AE` |
| `mobile-360-vi.png` | `9BDBF4056991DB22ED0D5BFCF8F063997E78B01FCF9D7A781EBF35B43AD2D795` |

Canonical tracked baseline:
`tests/e2e/sprint19-wave0-shell.spec.ts-snapshots/sprint19-wave0-gallery-ready-linux.png`

`SHA256=A69A86228ACDE377B3E9F15CB19C97188B516E174EB8B4D81328A7434F3ED84A`

Failure-only artifact behavior: enabled; success-run upload is skipped as
expected. No failed-run actual or diff image is a baseline.

## Acceptance result

SCREEN_ROWS_19_0_1_TO_19_0_13=ALL_ACCEPTED
SCREEN_INVENTORY=PASS
ROLE_USABILITY_MATRIX=PASS
DESIGN_SYSTEM=PASS
COMPONENT_GALLERY=PASS
ADMIN_SHELL=PASS
OWNER_MOBILE_SHELL=PASS
STAFF_MOBILE_SHELL=PASS
LOCALIZATION=PASS
VI_VN=PASS
EN_US=PASS
MOJIBAKE=0
RESPONSIVE=PASS
ACCESSIBILITY=PASS
VISUAL_REGRESSION=PASS
FONT_RENDER_DETERMINISM=PASS

Business rows are appended one screen at a time after Wave 0 acceptance. Wave 1
rows below are accepted only for the evidence explicitly listed. Wave 2 and all
later business waves remain unauthorized by this ledger.

## Wave 1 rows

Wave 1 final source validation is commit
`5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e`, validated by full CI run
`30985009361` (`SUCCESS`). The documentation commit that follows is not the
source commit for that CI run.

| ID | Route / surface | Persona | Permission and scope | API / evidence | Required states and QA | Locale | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.1.1 | `/admin/dashboard` Today dashboard | Owner, Manager, Receptionist | `operations.board.read`, branch scope | `/v1/operations/summary`, `/v1/operations/board`; `tests/e2e/sprint19-wave1-booking-operations.spec.ts` | Loading, ready, empty, error/retry, forbidden, offline, responsive overflow check | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.2 | `/admin/calendar/day`, `/admin/calendar/week` | Owner, Manager, Receptionist | `calendar.*`, branch scope | `/v1/calendar/events`; targeted Wave 1 + Sprint 3 E2E | Loading, ready, empty, error/retry, forbidden, responsive overflow check | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.3 | `/admin/appointments` booking list | Owner, Manager, Receptionist | `appointment.read`, branch scope | `/v1/appointments`; targeted Wave 1 + Sprint 4 E2E | Loading, ready, empty, error/retry, forbidden, filters, responsive overflow check | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.4 | `/admin/appointments/new` create booking | Receptionist, Manager | `appointment.create`, branch scope | Existing Sprint 4 booking flow; Wave 1 route smoke | Validation, loading, conflict, forbidden, success/error | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.5 | `/admin/appointments/:id/overview` booking detail | Owner, Manager, Receptionist, Technician | Appointment branch/own-staff scope | Existing appointment detail surface; Wave 1 route smoke | Loading, ready, not found, forbidden, retry | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.6 | `/manage-booking` reschedule | Customer, Receptionist | Public token or appointment scope | Public search/availability/hold; authenticated public-booking E2E | Loading, no-slot, validation, conflict, retry, success | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.7 | `/admin/appointments/:id/cancel` cancel/no-show surface | Manager, Receptionist | `appointment.cancel`, branch scope | Existing command surface; Wave 1 route smoke | Reason validation, forbidden, conflict, success/error; no-show policy unchanged | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.8 | `/admin/availability/search` availability | Receptionist, Manager | `availability.read`, branch scope | `/v1/availability`; targeted Wave 1 + Sprint 3 E2E | Loading, ready, empty, error/retry, forbidden, offline | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.9 | `/admin/scheduling/blocks` busy block | Manager, Owner | `availability.block.manage`, branch scope | `/v1/availability-blocks`; Wave 1 route smoke | Validation, conflict, forbidden, success/error | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.10 | `/admin/operations/walk-ins/new` walk-in creation | Receptionist, Manager | `walkin.create`, branch scope | `/v1/walk-ins`; Wave 1 route smoke | Validation, ETA empty/error, forbidden, success | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.11 | `/admin/operations/board`, `/admin/operations/walk-ins` queue board | Receptionist, Manager | `operations.board.read`, `walkin.read`, branch scope | Sprint 5 operational APIs; Wave 1 route smoke | Loading, empty, error/retry, forbidden, stale/offline, realtime refetch | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.12 | `/admin/appointments/:id/check-in` check-in | Receptionist, Manager | `appointment.check_in`, branch scope | Sprint 5 arrival/check-in APIs; Wave 1 route smoke | Early/late warning, validation, conflict, forbidden, success/error | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.13 | `/admin/appointments/:id/execution`, `/admin/service-sessions/:id` | Technician, Manager | `service_session.read_own`/`read_branch` | Sprint 5 session APIs; Wave 1 route smoke | Loading, ready, forbidden, offline, version conflict, retry | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.14 | `/admin/appointments/:id/add-service` add-service approval | Receptionist, Technician, Manager | `service_session.add_service`, branch scope | Sprint 5 plan/hold/commit APIs; Wave 1 route smoke | Validation, availability conflict, approval, forbidden, retry | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.15 | Staff assignment detail | Manager, Receptionist, Technician | Existing assignment scope | Assignment API, staff availability and authorization evidence | Loading, conflict, forbidden, retry | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |
| 19.1.16 | Staff transfer and segment assignment | Manager, Technician | `service_session.transfer_staff`, branch/own-staff scope | Transfer command, segment history and authorization evidence | Busy/skill conflict, version conflict, forbidden, success/error | vi-VN/en-US | `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e` | `30985009361 / SUCCESS` | ACCEPTED |

## Wave 1 evidence and scope

- Targeted local QA before the full run: legacy Sprint 3/4 E2E `11 passed`;
   Wave 1 remediation visual/accessibility E2E `2 passed`; Sprint 12
   clock-to-overtime E2E with Worker `1 passed`; public booking reschedule
   `1 passed` after the appointment-exclusion correctness fix.
- Final source SHA: `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e`; full CI run
  `30985009361`; Wave 1 remediation visual/accessibility lane, quality lane,
  builds and stop-containers all SUCCESS.
- Remediation component: `apps/admin-web/lib/sprint19-wave1-remediation.tsx`.
- Remediation E2E: `tests/e2e/sprint19-wave1-remediation.spec.ts`; targeted
  visual/accessibility result `2 passed`, AXE critical/serious `0`.
- Deterministic screenshot evidence was generated by targeted Playwright.
  Pixel-baseline regression is not claimed unless a `toHaveScreenshot`
  assertion is present.
- No screenshot is claimed for rows without a deterministic committed baseline;
  the evidence is route/API/E2E evidence recorded above.
- `MIGRATION_CHANGED=NO`; business state machines, tenant isolation, branch
  scope, permission guards, idempotency, audit/outbox and realtime refetch
  semantics were preserved.

## Wave 1 acceptance summary

```text
SCREEN_ROWS_19_1_1_TO_19_1_16=ALL_ACCEPTED
CLUSTER_1=ACCEPTED
CLUSTER_2=ACCEPTED
CLUSTER_3=ACCEPTED
CLUSTER_4=ACCEPTED
RESPONSIVE=PASS
ACCESSIBILITY=PASS
VI_VN=PASS
EN_US=PASS
MOJIBAKE=0
BOOKING_STATE_CORRECTNESS=PASS
TENANT_ISOLATION=PASS
BRANCH_AUTHORIZATION=PASS
ROLE_AUTHORIZATION=PASS
```
