# Sprint 2 granular permission matrix

| Role | Catalog | Staff | Scheduling | Leave |
|---|---|---|---|---|
| Salon owner | Full service/category/price/skill/resource | Full staff, branch and skill assignment | Create/update/publish/cancel shifts | Create branch, read/review/cancel |
| Branch manager | Read and branch-scoped updates | Read/create/update and branch assignment | Create/update/publish/cancel in assigned branches | Create branch, read/review/cancel in assigned branches |
| Receptionist | Read catalog/staff/resources | Read staff | Read shifts | Read branch leave |
| Nail technician | Read catalog/staff, own skills | Read own profile | Read own shifts | Create/read/update/submit own leave only |
| Accountant | Read services/prices | Read staff | Read shifts | No leave review |
| Marketing | Read active catalog | Read staff | No scheduling mutation | No leave access |
| Platform super admin | Explicit tenant denial | Explicit tenant denial | Explicit tenant denial | Explicit tenant denial |

Legacy aliases (`catalog.*`, `resource.manage`, `staff.manage`, `shift.manage`, `leave.manage`) are removed by migration `0006_sprint2_hardening`. Endpoint guards use only granular codes; `RequireAnyPermission` is used where an owner/manager branch reviewer and technician own-leave reader share a route.
