# Sprint 11 Permission Matrix

| Capability                   |                        Owner |    Manager (branch) |             Reception | Technician (assigned) |                   Marketing |   Accountant | Platform Admin |
| ---------------------------- | ---------------------------: | ------------------: | --------------------: | --------------------: | --------------------------: | -----------: | -------------: |
| Preferences/consent evidence |                          All |              Branch | Read/capture/withdraw |                    No |                          No |           No |         Denied |
| Templates/rules/messages     |                          All | Branch messages only |                    No |                    No | Branch messages/read only | Reports only |         Denied |
| Segment/campaign             |     Tenant + all branches | Branch only + approve |                    No |                    No | Branch create/schedule, no approve |       Report |         Denied |
| Reviews                      |             Moderate/respond |              Branch |                  Read |                    No |                 Read/report |       Report |         Denied |
| Recovery                     |                          All |              Branch |   Create/read/contact | Assigned read/contact |                          No |       Report |         Denied |
| Compensation                 | Request/approve dual-control | Branch dual-control |    Request if granted |                    No |                          No |       Report |         Denied |

Tenant-wide (`branch_id IS NULL`) templates, rules, segments and campaigns are Salon Owner only. A non-owner must supply a branch in `auth.branchIds`; the same restriction applies to `branchVisited` filters, reads and lifecycle commands. Platform Super Admin has no salon-data access without the existing Support Access Grant. Cross-tenant identifiers are never trusted; branch scope is evaluated in services and SQL predicates.
