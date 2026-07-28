# Sprint 10 Permission Matrix

| Capability                         | Owner | Manager | Reception | Cashier | Technician | Accountant | Marketing | Customer | Platform admin |
| ---------------------------------- | ----: | ------: | --------: | ------: | ---------: | ---------: | --------: | -------: | -------------: |
| Product read/manage                |   Yes |     Yes |        No |    Read |         No |         No |      Read |       No |         Denied |
| Issue/redeem/release               |   Yes |     Yes |        No |     Yes |         No |         No |        No |       No |         Denied |
| Card read/balance                  |   Yes |     Yes |       Yes |     Yes |         No |        Yes |        No | Own only |         Denied |
| Card suspend/cancel/replace/reload |   Yes |     Yes |        No |      No |         No |         No |        No |       No |         Denied |
| Customer credit read               |   Yes |     Yes |       Yes |     Yes |         No |        Yes |        No | Own only |         Denied |
| Credit adjustment request/approve  |   Yes |     Yes |        No |      No |         No |         No |        No |       No |         Denied |
| Liability/reconciliation/export    |   Yes |     Yes |        No |      No |         No |        Yes |        No |       No |         Denied |
| Legal policy read/manage           |   Yes |     Yes |        No |      No |         No |       Read |        No |       No |         Denied |

Platform support requires an explicit support-access grant; the platform role alone receives no salon stored-value permission. Customer reads resolve the linked customer from authenticated contact and return not-found for any other customer/card.

Owner rows are tenant-scoped. Manager rows are always restricted to assigned branches through issuance/activity, reservation, funding, ledger or adjustment attribution. Cross-branch redemption may be allowed by the immutable product snapshot, but the actor must still be authorized for the redemption order branch. Accountant reporting follows the permission plus branch scope carried by the authenticated workspace.
