# Sprint 19 Wave 8 — Owner Mobile

```text
STATUS=SPRINT_19_WAVE_8_IN_PROGRESS
REPORT_STATUS=DRAFT_PENDING_SOURCE_CI

START_CHECKPOINT=0ed88c936c9e6ecd8220a5e8b2d214beb337f15a

SCREEN_ROWS_19_8_1_TO_19_8_12=IMPLEMENTED_PENDING_QA

WAVE8_FOUNDATION=IMPLEMENTED_PENDING_QA
CLUSTER_1_AUTH_HOME_PROFILE=IMPLEMENTED_PENDING_QA
CLUSTER_2_OPERATIONS_BOOKINGS=IMPLEMENTED_PENDING_QA
CLUSTER_3_APPROVALS_FINANCE_WORKFORCE=IMPLEMENTED_PENDING_QA
CLUSTER_4_INVENTORY_ASSETS_ANALYTICS=IMPLEMENTED_PENDING_QA
CLUSTER_5_BILLING_SECURITY=IMPLEMENTED_PENDING_QA

NEW_BUSINESS_API=NO
NEW_PERMISSION=NO
MIGRATION_CHANGED=NO
SEED_CHANGED=NO
STATE_MACHINE_CHANGED=NO

WAVE8_SOURCE_CI=PENDING
WAVE8_ACCEPTANCE=PENDING

WAVE_9_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Scope and implementation evidence

Wave 8 modernizes Owner Mobile from the checkpoint above. The implementation
uses existing Auth Context, permission, branch, booking, operations, finance,
workforce, inventory, procurement, asset, analytics, billing and security
contracts. The additive Auth Context capability projection is
`capabilities.ownerMobileEnabled`; it is a product entitlement signal and does
not replace server authorization.

Foundation work includes login without a production tenant slug, memory-only
workspace and MFA handoff state, SecureStore refresh-token handling, explicit
logout cleanup, access-mode recovery navigation, authorized branch context,
permission-aware route descriptors, stable command intent keys, version-conflict
handling, and safe field projections for sensitive records. Financial,
approval, payroll, procurement, asset and support mutations remain online-only
and server-authoritative.

## Authorized logical screens

| ID | Logical screen | Route group | Offline writes | Current status |
| --- | --- | --- | --- | --- |
| 19.8.1 | Owner home executive overview | `/` | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.2 | Today operations | `/operationalSummary`, `/walkInQueue`, `/appointmentsToday` | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.3 | Bookings, calendar and availability | `/appointments`, `/appointment`, `/calendarDay`, `/calendarWeek`, `/availability` | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.4 | Federated approval inbox | Existing owning-domain approval routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.5 | Financial overview | Existing financial/report routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.6 | Workforce and payroll | Existing workforce/payroll routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.7 | Inventory and procurement | Existing inventory/procurement routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.8 | Fixed assets | Existing asset routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.9 | Analytics and alerts | `/analyticsOverview`, `/analyticsBranches`, `/analyticsAlerts` | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.10 | SaaS billing | Existing tenant billing routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.11 | Support access and security | Existing support/session routes | DENIED | IMPLEMENTED_PENDING_QA |
| 19.8.12 | Profile, auth and settings | `/profile`, `/workspace`, `/mfa` | DENIED | IMPLEMENTED_PENDING_QA |

## Local gate status

The affected static and build checks completed locally during implementation:

```text
OWNER_MOBILE_TYPECHECK=PASS
OWNER_MOBILE_LINT=PASS
OWNER_MOBILE_BUILD=PASS
API_TYPECHECK=PASS
API_BUILD=PASS
ADMIN_WEB_BUILD=PASS
WAVE8_MOBILE_AND_CONTRACT_TESTS=PASS
IDENTITY_AND_SESSION_INTEGRATION=PASS
OWNER_MOBILE_VISUAL_E2E_LOCAL=PASS
OWNER_MOBILE_VISUAL_REPEATABILITY=3/3_PASS
METRO_SINGLE_REACT_RUNTIME=PASS
SECURITY_SCAN=PASS
SECURITY_EVIDENCE_LOCAL=BLOCKED_PNPM_AUDIT_SHAPE
DOCKER_COMPOSE_RUNNING_SERVICES=0
```

These local results do not replace the required exact-source GitHub Actions
quality, mobile contract, authenticated E2E and visual/accessibility lanes.
The local `security:evidence` command completed secret/static checks but could
not complete its dependency-audit adapter because the installed pnpm audit
output did not contain the shape expected by the repository script. No
security exception, dependency version, or workflow bypass was added; the CI
supply-chain lane remains authoritative.
Wave 8 must remain pending until those lanes pass on one final source commit.

```text
FINAL_WAVE_8_SOURCE_SHA=PENDING
FINAL_WAVE_8_CI_RUN_ID=PENDING
FINAL_WAVE_8_CI_CONCLUSION=PENDING
```
