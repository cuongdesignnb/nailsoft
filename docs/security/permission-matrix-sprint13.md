# Sprint 13 permission matrix

| Actor | Tenant billing | Platform billing | Salon data | Support |
|---|---|---|---|---|
| Salon Owner | Own tenant | Denied | Own scope | Approve/deny/revoke |
| Platform Billing Admin | Denied without tenant membership | Granted permissions | Denied | Grant metadata |
| Platform Support | Denied by default | Grant operations | Active scoped session only | Request/start own session |
| Other salon roles | Denied | Denied | Existing role scope | Denied |

`PLATFORM_SUPER_ADMIN` receives `platform.*` permissions but no implicit salon-data capability.
