# Sprint 19 Wave 0 Report

STATUS=IN_PROGRESS
PHASE=Wave 0 foundation and Screen 19.0.11 remediation
START_CHECKPOINT=2c9f1ecbec44bf561457b305bd8e727d08b72dea
WAVE_1_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO

## Implemented foundation

- Semantic navy light design tokens and shared Web/Native UI packages.
- Shared icon names, localization, locale formatters and mojibake detector.
- Additive typed `GET /v1/auth/context` API with OpenAPI contract.
- Permission-aware Admin Shell, branch workspace context, responsive mobile drawer and skip link.
- Owner and Staff Mobile shells with shared session context.
- Component gallery route restricted to development/test configuration.

## Screen 19.0.11 remediation status

- Gallery expanded with actions, statuses, form validation surface, filters, table/list, pagination, tabs, dialog, banner, async states, timeline, progress and chart/table fallback.
- Chart fallback includes accessible description, table headers, localized currency and loading/empty states.
- Sidebar uses a viewport-height frame with independent content scrolling; mobile uses a drawer.
- Locale switching is available for `vi-VN` and `en-US`.
- Ready and skip-link-focus screenshots are required evidence and remain pending the next deterministic QA run.

## Quality evidence

LINT=PASS
TYPECHECK=PASS
TARGETED_E2E=PASS_3_OF_3
RESPONSIVE_EVIDENCE=PASS_6_VIEWPORTS
AXE_EVIDENCE=PASS_0_VIOLATIONS
DOCKER_QA_SERVICES=0

## Evidence manifest

Evidence root: `artifacts/sprint19/screens/19.0.11/` (generated locally and intentionally ignored)

| File | SHA-256 |
| --- | --- |
| `gallery-desktop-ready.png` | `D7DC21ADD4CC824372A24D944C836AE200C56C3F4816CEEA67A0A1711DF32C48` |
| `gallery-skip-link-focus.png` | `C7F9C0D90C6D4AFA22F356F2CD9FC4FD43E8301648C1D8175FB9DBC1F676B11A` |
| `gallery-desktop-en-US.png` | `7E73534ADDF47DC925B64D84936B7EB930E32F2F0FB40063594757FF3157A1C1` |
| `gallery-desktop-vi-VN.png` | `6CABB5FC4E295E263736191BBC2E773C8EE5D8FB068A55AD70ABFB0330450328` |

Responsive files: `desktop-1440-vi.png`, `desktop-1280-vi.png`, `tablet-1024-vi.png`, `tablet-768-vi.png`, `mobile-390-vi.png`, `mobile-360-vi.png`. The Playwright run verified no horizontal overflow at each viewport.

## Outstanding Wave 0 acceptance gates

1. Record the complete screenshot hash manifest and keyboard/zoom results in the ledger.
2. Run targeted Wave 0 CI lanes and full affected builds.
3. Commit documentation and implementation in separated intentional commits.

Wave 1 is not authorized until all 19.0.1-19.0.13 rows are accepted.
