# Sprint 19 Screen Acceptance Ledger

Current phase: Wave 7 accepted against source CI; Wave 8 not authorized
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
and Wave 2 rows below are accepted only for the evidence explicitly listed.
Wave 4 and Wave 5 rows are accepted against their exact source CI evidence.
Wave 6 and later business waves remain unauthorized.

## Wave 4 acceptance

The Wave 4 renderer uses the existing staff, scheduling, attendance, timesheet,
workforce, payroll and payout APIs. No migration, permission, state-machine or
business-contract change is included.

Final Wave 4 source validation is commit
`e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6`, validated by full CI run
`31184779182` with conclusion `SUCCESS`. The documentation commit that follows
is not the source commit validated by that CI run.

```text
WAVE_4_SCREEN_ROWS=19.4.1_TO_19.4.14
WAVE_4_SOURCE_SHA=e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6
WAVE_4_SOURCE_CI_RUN_ID=31184779182
WAVE_4_SOURCE_CI_CONCLUSION=SUCCESS

WAVE_4_STATUS=COMPLETED
BA_PO_WAVE_4_ACCEPTANCE=PASS

SCREEN_ROWS_19_4_1_TO_19_4_14=ALL_ACCEPTED
WAVE_5_STARTED=NO
SPRINT_20_STARTED=NO
```

| ID | Route / surface | Persona | Permission and scope | API / evidence | Required states and QA | Locale | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.4.1 | `/admin/staff/list`, `/admin/staff/new` staff directory and create | Owner, Manager | `staff.read`, `staff.create`; tenant/branch | `/v1/staff`; staff directory/create E2E | Loading, empty, retry, forbidden, validation, success | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.2 | `/admin/staff/:id` staff profile, branches and skills | Owner, Manager | `staff.read`, assignment scope | Staff profile/branch/skill APIs | Loading, error, forbidden, version conflict | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.3 | `/admin/scheduling/shifts` shift planner | Owner, Manager, Receptionist | `shift.*`; branch | `/v1/shifts`; shift conflict E2E | Loading, empty, validation, conflict, success | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.4 | `/admin/scheduling/leave-requests` leave review | Owner, Manager | `leave.read_branch`, `leave.review_branch` | `/v1/leave-requests`; state guard E2E | Loading, empty, forbidden, state conflict | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.5 | `/admin/time-clock`, `/admin/time-clock/sessions` live clock and sessions | Manager, Technician | `time_clock.*`; branch/own staff | `/v1/time-clock`; server-time E2E | Loading, empty, retry, forbidden, branch/own scope | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.6 | `/admin/time-clock/exceptions`, `/admin/time-clock/devices` attendance exceptions and devices | Manager | `time_clock.exception.*`, device scope | Exception/trusted-device APIs; sensitive payload guard | Loading, action feedback, forbidden | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.7 | `/admin/timesheets`, `/admin/timesheets/:id`, `/admin/timesheet-periods` timesheets and periods | Manager, Accountant | `timesheet.*`; branch | Timesheet/review/lock/period APIs | Loading, empty, review, lock, immutable source | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.8 | `/admin/workforce/policies`, `/admin/workforce/compliance`, `/admin/workforce/reports` workforce policies, compliance and reports | Owner, Manager, Accountant | `workforce.policy.*`, report scope | Versioned policy/compliance/report APIs | Loading, empty, forbidden, retry | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.9 | `/admin/staff/:id/pay-profile` staff pay profile | Owner, Accountant | `pay_profile.*`; tenant/staff | Effective-dated pay profile API; privacy E2E | Loading, validation, version conflict, success, privacy | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.10 | `/admin/payroll/calendars`, `/admin/payroll/periods` payroll calendars and periods | Owner, Accountant | `payroll.calendar.*`, period scope | Payroll calendar/period APIs | Loading, empty, validation, forbidden | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.11 | `/admin/payroll/runs`, `/admin/payroll/runs/:id`, `/admin/payroll/exceptions` payroll runs and exceptions | Owner, Accountant | Payroll run/exception permissions | Calculate/recalculate/approval/finalize APIs | Loading, immutable states, conflict, retry | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.12 | `/admin/payroll/statements`, `/admin/payroll/reports` pay statements and reports | Owner, Accountant, Technician | Statement/report read scope | Pay statement/report APIs; privacy guard | Loading, empty, privacy, forbidden | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.13 | `/admin/payouts`, `/admin/payouts/:id` payout batches | Owner, Accountant | Payout dual-control scope | Payout batch APIs; exactly-once/evidence E2E | Loading, approval, processing, error | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |
| 19.4.14 | `/admin/payout-reconciliation` payout reconciliation | Owner, Accountant | Reconciliation scope | Reconciliation API; variance evidence E2E | Loading, empty, variance, forbidden | vi-VN/en-US | `e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6` | `31184779182 / SUCCESS` | ACCEPTED |

```text
COMMON_EVIDENCE=SOURCE_COMMIT e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6; CI 31184779182 / SUCCESS; ACCEPTANCE ACCEPTED
SCREEN_ROWS_19_4_1_TO_19_4_14=ALL_ACCEPTED
WAVE_4_STATUS=COMPLETED
BA_PO_WAVE_4_ACCEPTANCE=PASS
```

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

## Wave 2 accepted ledger

Wave 2 final source validation is commit
`83474b1f12c107292b0b4144923b16edff39a720`, validated by full CI run
`31085184446` with conclusion `SUCCESS`. The documentation commit created
afterwards is not the source commit validated by that CI run.

| ID | Route / surface | Primary permission | API contract | State coverage | Evidence | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.2.1 | `/admin/pos` POS home/register context | `financial.summary.read`, `cash_session.read` | summary, orders, sessions | loading, ready, empty, error/retry, forbidden, offline, stale/version conflict | `tests/e2e/sprint19-wave2-pos-cash.spec.ts` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.2 | `/admin/pos/orders` open/held orders | `pos.order.read` | `/v1/pos-orders` | loading, ready, empty, error/retry, forbidden, stale/offline | `tests/e2e/sprint19-wave2-pos-cash.spec.ts` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.3 | `/admin/pos/new` new sale workspace | `pos.order.create` | appointment POS order command | loading, validation, conflict, success, forbidden | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.4 | `/admin/pos/new`, `/admin/pos/checkout/:id` customer/appointment link | appointment/POS scope | appointment detail/create | loading, ready, not found, forbidden, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.5 | `/admin/pos/orders/:id` cart lines | `pos.order.update` | order detail/line/recalculate | loading, empty, validation, version conflict, success | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.6 | `/admin/pos/orders/:id` discount/tax/tip | `pos.discount.*`, `pos.tip.set` | discount, tip, server totals | loading, approval, success, error, conflict | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.7 | `/admin/pos/orders/:id/payment` checkout summary | payment capture permission | order/payment detail | loading, review, invalid, conflict, forbidden | `tests/e2e/sprint19-wave2-pos-cash.spec.ts` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.8 | `/admin/pos/orders/:id/payment` split tender | payment capture permission | POS payment command | loading, submitting, success, failed, unknown | `tests/e2e/sprint19-wave2-pos-cash.spec.ts` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.9 | `/admin/pos/orders/:id/payment` result/recovery | payment read/command scope | order/payment detail | processing, unknown, requires action, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.10 | `/admin/pos/orders/:id/receipt`, invoices | `invoice.read`, `invoice.print` | invoice print/detail | loading, immutable ready, forbidden, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.11 | `/admin/pos/registers`, open session | `cash_session.read/open` | registers/open | loading, validation, device/branch conflict, success | `tests/e2e/sprint19-wave2-pos-cash.spec.ts` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.12 | `/admin/pos/cash-sessions/:id` drawer/movements | `cash_session.read/move_cash` | session/movements/move | loading, empty, validation, conflict, forbidden | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.13 | `/admin/pos/cash-sessions/:id/close` blind count/close | `cash_session.declare/close` | review/declare/close | loading, blind, pending, conflict, success | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.14 | closing review/reconciliation | `cash_session.approve_variance` | closing review/reconciliation | loading, variance, approval, forbidden, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.15 | `/admin/refunds/new` refund initiation | `refund.request` | refund plan/create | loading, validation, policy, success/error | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.16 | `/admin/refunds`, `/:id` allocation/review | `refund.read/approve` | refund list/detail/commands | loading, empty, approval, conflict, retry, forbidden | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.17 | `/admin/credit-notes`, `/:id` credit note | `credit_note.read/print` | credit note detail/delivery | loading, immutable ready, forbidden, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |
| 19.2.18 | `/admin/commission` reversal evidence | commission read/adjustment | entries/adjustments | loading, empty, approval, forbidden, retry | `apps/admin-web/lib/sprint19-wave2-screen.tsx` | `83474b1f` | `31085184446 / SUCCESS` | ACCEPTED |

### Wave 2 route ownership

Wave 2 commission evidence owns only `/admin/commission`,
`/admin/commission/entries` and `/admin/commission/adjustments`. Sprint 7 owns
the commission rule and period workflows: `/admin/commission/rules*` and
`/admin/commission/periods*`. Row `19.2.18` represents contribution/reversal
evidence and adjustments, not the rule or period workflow.

### Wave 2 state and safety acceptance

```text
SCREEN_ROWS_19_2_1_TO_19_2_18=ALL_ACCEPTED
POS_STATE_COVERAGE=PASS
PAYMENT_STATE_COVERAGE=PASS
CASH_REGISTER_STATE_COVERAGE=PASS
REFUND_STATE_COVERAGE=PASS
SERVER_AUTHORITATIVE_TOTALS=PASS
PAYMENT_IDEMPOTENCY=PASS
INVOICE_IMMUTABILITY=PASS
REGISTER_DEVICE_GUARDS=PASS
BLIND_COUNT=PASS
DUAL_CONTROL_CLOSE=PASS
REFUND_CORRECTNESS=PASS
CREDIT_NOTE_IMMUTABILITY=PASS
TIP_REVERSAL=PASS
COMMISSION_REVERSAL=PASS
TENANT_ISOLATION=PASS
BRANCH_AUTHORIZATION=PASS
ROLE_AUTHORIZATION=PASS
AUDIT_OUTBOX=PASS
RESPONSIVE=PASS
ACCESSIBILITY=PASS
VI_VN=PASS
EN_US=PASS
MOJIBAKE=0
```

The Wave 2 renderer consumes the existing Sprint 6–7 API contracts and
idempotency headers. No state machine, currency semantics, tenant isolation,
branch scope, permission guard, audit/outbox behavior, migration or business
logic was changed for this documentation closure.

```text
WAVE_2_STATUS=COMPLETED
BA_PO_WAVE_2_ACCEPTANCE=PASS
SPRINT_19_STATUS=IN_PROGRESS
WAVE_3_STATUS=COMPLETED_WITH_DOCUMENTED_DEFERRAL
WAVE_3_CLUSTER_1A_STATUS=ACCEPTED_WITH_DEFERRED_SCOPE
SCREEN_ROWS_19_3_1_3_3_3_4_3_5=ACCEPTED
SCREEN_ROW_19_3_2=ACCEPTED_WITH_DEFERRED_SCOPE
CUSTOMER_UPDATE_CONTRACT=NOT_AUTHORIZED
CUSTOMER_MERGE_CONTRACT=NOT_AUTHORIZED
CUSTOMER_ENGAGEMENT_ROUTE_OWNERSHIP=SPRINT_11_RETAINED
CUSTOMER_360_UI_SOURCE=46f6d3c5476785ad64159bcdf9cdb66290102e54
WAVE_3_STARTED=YES
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 3 Cluster 2 acceptance

```text
WAVE_3_CLUSTER_2_STATUS=ACCEPTED
SCREEN_ROWS_19_3_6_TO_19_3_9=ACCEPTED
BENEFITS_WALLET=ACCEPTED
LOYALTY_DUAL_CONTROL_SURFACE=ACCEPTED
MEMBERSHIP_HISTORY=ACCEPTED
PACKAGE_ENTITLEMENT_LEDGER=ACCEPTED
SERVER_AUTHORITATIVE_BALANCES=YES
SECRET_MASKING=YES
POS_ROUTE_OWNERSHIP_PRESERVED=YES
CLUSTER_2_LOCAL_QA=PASS
WAVE_3_STATUS=COMPLETED_WITH_DOCUMENTED_DEFERRAL
WAVE_4_STARTED=NO
SPRINT_20_STARTED=NO
```

## Wave 3 final source evidence and acceptance

Wave 3 final source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`.

The documentation commit that follows is not the source commit for that CI
run. Source and documentation provenance remain separate.

```text
WAVE_3_REMOTE_START_CHECKPOINT=da8ecc107b85f4ad6877aee7b154f342fcba2d57
FINAL_WAVE_3_SOURCE_SHA=638831f2021c4994a838eb19e213e3744381ee2b
FINAL_WAVE_3_CI_RUN_ID=31168662060
FINAL_WAVE_3_CI_CONCLUSION=SUCCESS
QUALITY_JOB_ID=92835222116
QUALITY_JOB=SUCCESS
VISUAL_JOB_ID=92835222009
VISUAL_JOB=SUCCESS

FULLY_ACCEPTED_SCREEN_ROWS=14
ACCEPTED_WITH_DEFERRED_SCOPE_SCREEN_ROWS=1
ROW_19_3_2=ACCEPTED_WITH_DEFERRED_SCOPE
CUSTOMER_UPDATE=DEFERRED
CUSTOMER_MERGE=DEFERRED
DEFERRED_ITEM_DESTINATION=FUTURE_CUSTOMER_MUTATION_ADDENDUM_OR_PRODUCT_BACKLOG
```

| ID | Route / surface | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- |
| 19.3.1 | Customer directory and search | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.2 | Customer create and duplicate-safe resolution | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED_WITH_DEFERRED_SCOPE |
| 19.3.3 | Customer 360 profile | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.4 | Booking, visit and purchase history | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.5 | Consent and engagement timeline | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.6 | Customer benefits wallet | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.7 | Loyalty adjustment and ledger | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.8 | Membership tiers and customer history | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.9 | Package catalog, entitlements and ledger | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.10 | Voucher campaigns, codes and customer vouchers | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.11 | Gift-card products, issuance and detail | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.12 | Customer credit and stored-value adjustments | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.13 | Communications, segments and email campaigns | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.14 | Reviews and review requests | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.15 | Service recovery, compensation and timeline | `638831f2021c4994a838eb19e213e3744381ee2b` | `31168662060 / SUCCESS` | ACCEPTED |

Row `19.3.2` covers customer creation and duplicate-safe existing-customer
resolution. Customer Update and Customer Merge remain deferred and are not
claimed as implemented. The deferred scope is not assigned to Wave 4.

```text
WAVE_3_STATUS=COMPLETED_WITH_DOCUMENTED_DEFERRAL
BA_PO_WAVE_3_ACCEPTANCE=PASS_WITH_DOCUMENTED_DEFERRAL
WAVE_4_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 3 Cluster 4 acceptance

Cluster 4 covers the Admin Web communications, marketing, reviews and service
recovery routes. It uses existing APIs and keeps email consent, suppression,
dual-control and owning-domain compensation rules on the server. Acceptance is
validated by the exact final Wave 3 source CI run.

| ID | Route / surface | Persona | Permission and scope | API / evidence | Required states and QA | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.13 | Communications, segments and email campaigns | Owner, Manager, Marketing | `communication.*`, `marketing.*`, tenant/branch scope | Existing communication, segment and campaign APIs; Cluster 4 E2E | loading, ready, empty, retry, forbidden, offline, submitting, version conflict, consent/suppression, dual control | `6b054d57363091c45756aaa54e430b5305b2281f` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.14 | Reviews and review requests | Owner, Manager, Receptionist | `review.*`, branch scope | Existing review and request APIs; Cluster 4 E2E | loading, ready, empty, retry, forbidden, immutable customer content, response validation | `6b054d57363091c45756aaa54e430b5305b2281f` | `31168662060 / SUCCESS` | ACCEPTED |
| 19.3.15 | Service recovery, compensation and timeline | Owner, Manager, Receptionist, assigned Technician | `service_recovery.*`, branch/assigned-task scope | Existing recovery case, task and compensation APIs; Cluster 4 E2E | loading, ready, empty, retry, forbidden, version conflict, dual control, owning-domain handoff | `6b054d57363091c45756aaa54e430b5305b2281f` | `31168662060 / SUCCESS` | ACCEPTED |

```text
WAVE_3_CLUSTER_4_STATUS=ACCEPTED
SCREEN_ROWS_19_3_13_TO_19_3_15=ACCEPTED
EMAIL_ONLY=YES
CONSENT_AND_SUPPRESSION_SERVER_CHECKED=YES
COMPENSATION_OWNING_DOMAIN_HANDOFF=YES
ROUTE_OWNERSHIP_EXPLICIT=YES
MIGRATION_CHANGED=NO
WAVE_4_STARTED=NO
SPRINT_20_STARTED=NO
```

## Wave 3 Cluster 3 acceptance

```text
WAVE_3_CLUSTER_3_STATUS=ACCEPTED
SCREEN_ROWS_19_3_10_TO_19_3_12=ACCEPTED
VOUCHER_CAMPAIGNS_AND_MASKED_CODES=ACCEPTED
GIFT_CARD_PRODUCTS_ISSUANCE_HANDOFF_AND_DETAIL=ACCEPTED
CUSTOMER_CREDIT_AND_ADJUSTMENTS=ACCEPTED
SERVER_AUTHORITATIVE_BALANCES=YES
SECRET_MASKING=YES
DUAL_CONTROL_SURFACE=YES
POS_ROUTE_OWNERSHIP_PRESERVED=YES
LIABILITY_ROUTE_OWNERSHIP_PRESERVED=YES
CLUSTER_3_LOCAL_QA=PASS
WAVE_3_STATUS=COMPLETED_WITH_DOCUMENTED_DEFERRAL
WAVE_4_STARTED=NO
SPRINT_20_STARTED=NO
```

## Wave 5 acceptance — inventory, procurement and fixed assets

Final Wave 5 source validation is commit
`7d01aa86d94ebf4a7e6406082d3aeb176cac884c`, validated by full CI run
`31287558715` with conclusion `SUCCESS`.

The documentation commit created after this validation is not the source
commit validated by run `31287558715`.

```text
WAVE_5_SOURCE_SHA=7d01aa86d94ebf4a7e6406082d3aeb176cac884c
WAVE_5_SOURCE_CI_RUN_ID=31287558715
WAVE_5_SOURCE_CI_CONCLUSION=SUCCESS
WAVE_5_STATUS=COMPLETED
BA_PO_WAVE_5_ACCEPTANCE=PASS
SCREEN_ROWS_19_5_1_TO_19_5_36=ALL_ACCEPTED
WAVE_6_STARTED=NO
SPRINT_20_STARTED=NO
```

| ID | Screen | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- |
| 19.5.1 | Inventory items | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.2 | Stock locations | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.3 | Stock availability | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.4 | Lot and expiry | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.5 | Inventory alerts | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.6 | Inventory suppliers | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.7 | Inventory purchase orders | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.8 | Goods receipts | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.9 | Stock transfers | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.10 | Stock adjustments | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.11 | Blind stock counts | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.12 | Service material recipes | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.13 | Inventory ledger | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.14 | Inventory valuation | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.15 | Procurement control center | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.16 | Vendors | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.17 | Purchase requests | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.18 | Purchase orders | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.19 | Goods and service receipts | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.20 | Vendor bills | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.21 | Accounts payable | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.22 | Payment proposals | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.23 | Vendor payments | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.24 | Vendor credit notes | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.25 | Vendor returns | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.26 | Fixed asset register | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.27 | Asset candidates | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.28 | Capitalization approvals | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.29 | Depreciation runs | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.30 | Maintenance work orders | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.31 | Asset transfers | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.32 | Asset counts | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.33 | Inspections | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.34 | Impairments | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.35 | Disposals | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |
| 19.5.36 | Asset reports | `7d01aa86d94ebf4a7e6406082d3aeb176cac884c` | `31287558715 / SUCCESS` | ACCEPTED |

```text
INVENTORY_SCREEN_ROWS=14_ACCEPTED
PROCUREMENT_SCREEN_ROWS=11_ACCEPTED
FIXED_ASSET_SCREEN_ROWS=11_ACCEPTED
INVENTORY_CLUSTER=ACCEPTED
PROCUREMENT_CLUSTER=ACCEPTED
FIXED_ASSETS_CLUSTER=ACCEPTED
ADDENDUM_A_FOUNDATION=ACCEPTED
```

## Wave 6 acceptance ledger — source CI complete

Start checkpoint: `290e9ae24775ad89ffc9af9e982dad161878633a`.

Phase 0A support scope and Phase 0B read foundation are implemented locally;
all 34 Wave 6 rows are accepted against exact source commit
`c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc` and full CI run `31302322332`
(`SUCCESS`). The documentation commit created after this validation is not
the source commit validated by that run.

| Rows | Cluster | Source / API evidence | Source CI | Acceptance |
| --- | --- | --- | --- | --- |
| 19.6.1–19.6.11 | Accounting and banking | `/v1/accounting/*`; statement-line, match and exception reads | `c3c46ab5` / `31302322332` / SUCCESS | ACCEPTED |
| 19.6.12–19.6.18 | Tenant billing and support | `/v1/tenant/billing/*`; support grant API | `c3c46ab5` / `31302322332` / SUCCESS | ACCEPTED |
| 19.6.19–19.6.29 | Platform commerce and support | `/v1/platform/*`; support target scope; break-glass disabled read | `c3c46ab5` / `31302322332` / SUCCESS | ACCEPTED |
| 19.6.30–19.6.34 | Analytics | `/v1/analytics/*`; dedicated Wave 6 renderer | `c3c46ab5` / `31302322332` / SUCCESS | ACCEPTED |

```text
WAVE_6_STATUS=COMPLETED
WAVE_6_SOURCE_SHA=c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc
WAVE_6_CI_RUN_ID=31302322332
WAVE_6_CI_CONCLUSION=SUCCESS
BA_PO_WAVE_6_ACCEPTANCE=PASS
SCREEN_ROWS_19_6_1_TO_19_6_34=ALL_ACCEPTED
WAVE_6_STARTED=YES
SPRINT_19_STATUS=IN_PROGRESS
WAVE_7_STARTED=NO
WAVE_7_AUTHORIZED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO

DEFERRED_SCOPE_1=BANK_STATEMENT_LINE_EXCEPTION_EXCLUSION
DEFERRED_SCOPE_2=RECONCILIATION_MANUAL_EXCEPTION_ADJUSTMENT
DEFERRED_SCOPE_3=PLATFORM_DISCOUNT_MUTATION_LIFECYCLE
DEFERRED_SCOPE_4=MANUAL_DUNNING_ACTIONS
BREAK_GLASS=INTENTIONALLY_DISABLED_FOUNDATION
```

## Wave 7 acceptance ledger — accepted against exact source CI

Start checkpoint: `97ca6c643fcc427076948cbba4f827cce7ab3b95`.

The policy foundation and four public Booking Web clusters were validated by
full CI on exact source commit `214e90e58b1c8b25438b170c82622a77342de24b`.
The documentation commit created after this validation is not the source
commit validated by run `31324420953`.

| ID | Route / surface | Persona | Permission and scope | API / evidence | Required states and QA | Locale | Source commit | CI | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.7.1 | `/` public landing | Customer | Public tenant-neutral | Landing and salon-code resolution | Ready, error, mobile, axe | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.2 | `/book/[salonSlug]` salon/branch discovery | Customer | Active tenant/branch | Salon and branch profile | Available/unavailable, mobile, axe | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.3 | `/book/[salonSlug]` services/staff | Customer | Public offering policy | Services, prices, staff preference | Empty, reorder, policy, axe | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.4 | `/book/[salonSlug]` availability | Customer | Public booking capability | Availability and slot hold | Loading, empty, expired hold, timezone | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.5 | `/book/[salonSlug]` contact | Customer | Verified contact flow | Contact request | Validation, submitting, offline | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.6 | `/book/[salonSlug]` contact OTP | Customer | OTP rate-limit policy | OTP request/verify | Invalid, expired, limited, success | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.7 | `/book/[salonSlug]` review/policy | Customer | Explicit policy acceptance | Server hold plan | Policy changed, consent optional, axe | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.8 | `/book/[salonSlug]` result | Customer | No payment capture | Idempotent booking create | Submitting, success, no token display | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.9 | `/manage-booking` lookup | Customer | Neutral management lookup | Booking access request | Neutral error, retry, mobile | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.10 | `/manage-booking` OTP | Customer | Management OTP | OTP request/verify | Invalid, expired, resend | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.11 | `/manage-booking` detail/cancel/packages | Customer | Management bearer/domain policy | Detail, cancel, package reservation | Forbidden, conflict, success | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.12 | `/manage-booking` replacement availability | Customer | Management bearer | Replacement availability | Loading, empty, expired token | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |
| 19.7.13 | `/manage-booking` reschedule | Customer | FULL/GRACE + `booking.enabled` | Reschedule hold/commit | Version conflict, expired hold, success | vi-VN/en-US | `214e90e5` | `31324420953 / SUCCESS` | ACCEPTED |

```text
WAVE_7_SOURCE_SHA=214e90e58b1c8b25438b170c82622a77342de24b
WAVE_7_SOURCE_CI_RUN_ID=31324420953
WAVE_7_SOURCE_CI_CONCLUSION=SUCCESS
WAVE_7_STATUS=COMPLETED
BA_PO_WAVE_7_ACCEPTANCE=PASS
SCREEN_ROWS_19_7_1_TO_19_7_13=ALL_ACCEPTED
WAVE_8_STARTED=NO
SPRINT_20_STARTED=NO
```
