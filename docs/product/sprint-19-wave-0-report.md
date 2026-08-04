# Sprint 19 Wave 0 Report

STATUS=COMPLETED
WAVE_0_STATUS=COMPLETED
BA_PO_REVIEW_STATUS=PASS
PHASE=Wave 0 design system and application shell closure

SPRINT_19_START_CHECKPOINT=2c9f1ecbec44bf561457b305bd8e727d08b72dea
START_CHECKPOINT=2c9f1ecbec44bf561457b305bd8e727d08b72dea
CI_VALIDATED_SOURCE_SHA=0a6afb5df93a162ffdf1ff864f07a3b44f696f02
FINAL_SOURCE_SHA=0a6afb5df93a162ffdf1ff864f07a3b44f696f02

FULL_CI_RUN_ID=30892119845
FULL_CI_STATUS=COMPLETED
FULL_CI_CONCLUSION=SUCCESS
QUALITY_JOB_ID=91936400261
QUALITY_JOB_STATUS=SUCCESS
QUALITY_STEPS=ALL_SUCCESS
VISUAL_JOB_ID=91936400486
VISUAL_JOB_STATUS=SUCCESS
VISUAL_LANE=SUCCESS
FAILURE_ARTIFACT_STEP=SKIPPED_AS_EXPECTED

REFERENCE_BASELINE_STABILIZATION_SHA=ab06b49d19d8f01c81c741486787ddc97de15902
FAILURE_ARTIFACT_INSTRUMENTATION_SHA=4248a3983cbeee49794019677437b11e67a30318
TYPOGRAPHY_RENDERER_PINNING_SHA=8bb1f9526d3b410f3d8f223e37a287edc1497aaa
PROVIDER_LEASE_CI_FIX_SHA=2e15cfbe3090b7ef60aafd2abaf5876ea615f43a

HIGH_ADVISORIES=0
CRITICAL_ADVISORIES=0
MODERATE_ADVISORIES=6_TRACKED

WAVE_1_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO

## Closure decision

BA/PO accepts Sprint 19 Wave 0. The foundation, design system, localization,
application shells, component gallery, deterministic typography renderer and
acceptance evidence are complete. Wave 1 remains unauthorized until a separate
BA/PO handoff is approved.

No runtime/business contract was changed by this documentation closure. The
source CI evidence remains attached to `0a6afb5`; any later documentation-only
commit must not be represented as a source CI run.

## Implemented foundation

- Semantic navy light design tokens and shared Web/Native UI packages.
- Shared semantic icons, localization, locale formatters and mojibake detector.
- Additive typed `GET /v1/auth/context` API with OpenAPI contract.
- Permission-aware Admin Shell, tenant/branch workspace context, responsive
  mobile drawer and skip link.
- Owner and Staff Mobile shells with shared server session context.
- Component gallery route restricted to development/test configuration.
- Loading, ready, empty, error/retry, forbidden, stale/offline and partial UI
  state primitives with accessibility coverage.

## Wave 0 acceptance results

SCREEN_INVENTORY=PASS
ROLE_USABILITY_MATRIX=PASS
DESIGN_TOKENS=PASS
TYPOGRAPHY=PASS
FORMS=PASS
BUTTONS_ACTIONS=PASS
TABLE_DATA_LIST=PASS
MODAL_DRAWER_TOAST=PASS
ASYNC_PERMISSION_STATES=PASS
CHARTS=PASS
COMPONENT_GALLERY=PASS
ADMIN_SHELL=PASS
OWNER_MOBILE_SHELL=PASS
STAFF_MOBILE_SHELL=PASS
AUTH_CONTEXT_API=PASS
OPENAPI_CONTRACT=PASS
PERMISSION_AWARE_NAVIGATION=PASS
TENANT_BRANCH_CONTEXT=PASS
LOCALIZATION_NAVIGATION_CONTRACTS=PASS
VI_VN=PASS
EN_US=PASS
MIXED_LOCALE_STRINGS=0
MOJIBAKE=0

AUTHENTICATED_GALLERY_E2E=PASS
TARGETED_E2E=PASS_3_OF_3
RESPONSIVE_MATRIX=PASS
RESPONSIVE_EVIDENCE=PASS_6_VIEWPORTS
ACCESSIBILITY_AXE=PASS
AXE_EVIDENCE=PASS_0_VIOLATIONS
MANUAL_KEYBOARD_QA=PASS
VISUAL_REGRESSION=PASS
MOBILE_SHELL_SMOKE=PASS

FONT_BUNDLED_OR_SELF_HOSTED=YES
FONT_RUNTIME_CHECK=PASS
CANONICAL_RENDERER=PINNED_LINUX_PLAYWRIGHT
REMOTE_FONT_RUNTIME_REQUEST=NO
TOLERANCE_CHANGED=NO
ASSERTION_REMOVED=NO
FAILURE_ONLY_ARTIFACT=ENABLED
FAILURE_ONLY_ARTIFACT_SUCCESS_RUN_BEHAVIOR=SKIPPED

LINT=PASS
TYPECHECK=PASS
BUILD_API=SUCCESS
BUILD_WORKER=SUCCESS
BUILD_ADMIN_WEB=SUCCESS
BUILD_BOOKING_WEB=SUCCESS
BUILD_OWNER_MOBILE=SUCCESS
BUILD_STAFF_MOBILE=SUCCESS

DOCKER_QA=PASS
DOCKER_TEARDOWN=PASS
STOP_CONTAINERS=SUCCESS
DOCKER_COMPOSE_RUNNING_SERVICES=0

## Implementation and remediation notes

- Failure-only visual artifacts collect expected, actual and diff output from a
  failing GitHub runner. They do not soften the visual gate.
- Inter is bundled/self-hosted and the Playwright renderer is pinned to the
  Linux CI image. Visual tolerance was not increased and the screenshot
  assertion was not removed.
- The earlier visual mismatch was diagnosed as an unpinned font/renderer
  environment issue. The canonical Linux visual job now passes.
- The provider lease CI fix pauses the durable Worker only around the provider
  boundary assertion; it does not change the runtime provider contract.
- Dependency overrides leave High and Critical advisories at zero. Six Moderate
  advisories remain tracked as technical debt.

## Screen 19.0.11 evidence manifest

Evidence root: `artifacts/sprint19/screens/19.0.11/` (generated locally and
intentionally ignored). SHA-256 values below are the current deterministic
evidence files; failed-run `actual` and `diff` images are not baselines.

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

## Mobile Shell evidence

`tests/mobile/sprint19-wave0-mobile-shell.test.ts` covers Owner Mobile and
Staff Mobile role context, server auth context, QueryClientProvider,
MobileShell, own-staff scope and SafeAreaView. Full CI quality step 56,
`Sprint 19 Wave 0 mobile shell smoke`, completed successfully in run
`30892119845`.

OWNER_MOBILE_SHELL_SMOKE=PASS
STAFF_MOBILE_SHELL_SMOKE=PASS
LOADING_STATE=PASS
READY_STATE=PASS
FORBIDDEN_STATE=PASS
OFFLINE_STATE=PASS_OR_NOT_APPLICABLE_WITH_REASON
SAFE_AREA=PASS
TOUCH_TARGETS=PASS
ROLE_NAVIGATION=PASS
SESSION_CONTEXT=PASS

## Scope confirmation

RUNTIME_CODE_CHANGED=NO
VISUAL_BASELINE_CHANGED=NO
TEST_CHANGED=NO
WORKFLOW_CHANGED=NO
DEPENDENCY_CHANGED=NO
API_CHANGED=NO
MIGRATION_CHANGED=NO
SPRINT_19_COMPLETION_REPORT_CHANGED=NO

SPRINT_19_STATUS=IN_PROGRESS
WAVE_1_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
