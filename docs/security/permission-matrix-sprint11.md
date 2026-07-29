# Sprint 11 Permission Matrix

| Capability                   |                        Owner |    Manager (branch) |             Reception | Technician (assigned) |                   Marketing |   Accountant | Platform Admin |
| ---------------------------- | ---------------------------: | ------------------: | --------------------: | --------------------: | --------------------------: | -----------: | -------------: |
| Preferences/consent evidence |                          All |              Branch | Read/capture/withdraw |                    No |                          No |           No |         Denied |
| Templates/rules/messages     |                          All |              Branch |                    No |                    No |                 Manage/read | Reports only |         Denied |
| Segment/campaign             |                          All |    Branch + approve |                    No |                    No | Create/schedule, no approve |       Report |         Denied |
| Reviews                      |             Moderate/respond |              Branch |                  Read |                    No |                 Read/report |       Report |         Denied |
| Recovery                     |                          All |              Branch |   Create/read/contact | Assigned read/contact |                          No |       Report |         Denied |
| Compensation                 | Request/approve dual-control | Branch dual-control |    Request if granted |                    No |                          No |       Report |         Denied |

Platform Super Admin has no salon-data access without the existing Support Access Grant. Cross-tenant identifiers are never trusted; branch scope is evaluated in services and SQL predicates.
