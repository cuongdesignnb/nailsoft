# Sprint 13 permission matrix

## Closure dual-control rule

`platform.payment.manual_record`, `platform.payment.refund`, and `platform.credit_note.manage` authorize command execution but never identify the approver. Approval identity is always taken from the authenticated access token. The request creator is denied on approval/rejection commands, and `approvedByUserId` in any request payload is rejected. Platform Super Admin remains unable to access salon operational data without an active scoped Support Access Grant.

| Actor                  | Tenant billing                   | Platform billing    | Salon data                 | Support                   |
| ---------------------- | -------------------------------- | ------------------- | -------------------------- | ------------------------- |
| Salon Owner            | Own tenant                       | Denied              | Own scope                  | Approve/deny/revoke       |
| Platform Billing Admin | Denied without tenant membership | Granted permissions | Denied                     | Grant metadata            |
| Platform Support       | Denied by default                | Grant operations    | Active scoped session only | Request/start own session |
| Other salon roles      | Denied                           | Denied              | Existing role scope        | Denied                    |

`PLATFORM_SUPER_ADMIN` receives `platform.*` permissions but no implicit salon-data capability.
