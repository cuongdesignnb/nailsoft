# NailSoft Admin UI — Route & Archetype Matrix

## Phạm vi và nguồn kiểm kê

Tài liệu này là inventory route và archetype cho Admin UI sau đợt remediation UX. Nguồn là route literals, route matcher và navigation registry trong `apps/admin-web`; không tạo URL mới và không thay đổi API/DB.

- Base kiểm kê: `abcb6c5c13727e462cebb42b53ba401eea9da1df`.
- Route literals tĩnh được phát hiện trong source: **198** (bao gồm route alias được giữ tương thích).
- Navigation cấp một: **12 nhóm vận hành**, cộng nhóm Nền tảng chỉ dành cho `PLATFORM_SUPER_ADMIN`.
- Navigation cấp hai: destination được lọc theo permission/role; nhóm rỗng bị ẩn.
- Detail, command và nested workflow route không trở thành cấp ba trong sidebar; chúng dùng link từ màn hình sở hữu.

## Quy ước archetype

| Archetype | Dùng cho | Đặc điểm bắt buộc |
|---|---|---|
| Command center | Tổng quan salon, financial/marketing overview | KPI từ API, freshness, attention queue, CTA theo permission |
| Directory / workbench | Danh sách khách, nhân sự, dịch vụ, inventory | Tìm kiếm/lọc server-side khi contract hỗ trợ, bảng có caption, empty/error riêng |
| Calendar / operations board | Lịch hẹn, ca làm, vận hành salon | Mốc thời gian và trạng thái nghiệp vụ; mobile chuyển thành list/card |
| Master-detail | Khách hàng, campaign, order, refund, credit note | Chọn dòng có `aria-selected`, inspector/detail lấy từ API, không N+1 |
| Approval inbox | Điều chỉnh, leave, payroll, reconciliation | Status machine, version, idempotency, dual control, audit |
| Ledger / reconciliation | Tài chính, stored value, accounting, bank | Running/aggregate từ server, integer minor units, nguồn evidence |
| Form / guided creation | Tạo khách, nhân sự, segment, campaign, procurement | Selector từ API, validation domain, không bắt nhập raw UUID |
| Settings / policy | Organization, branch, security, communication rules | Form rõ phạm vi, permission-aware, không lẫn operational data |
| Technical delivery workspace | Communications messages, attempts, suppressions | Trạng thái provider thật; không thêm opened/clicked/delivered khi chưa có evidence |

## Ma trận route theo domain

| Route family / pattern | Domain | Parent / child trong sidebar | Archetype đích | Quyền / phạm vi | Responsive & trạng thái |
|---|---|---|---|---|---|
| `/admin/dashboard` | Command center | Tổng quan › Tổng quan salon | Command center | Authorization context + branch scope | KPI grid co lại; attention cards xếp dọc; loading/error không hiển thị số 0 giả |
| `/admin/appointments`, `/admin/appointments/new`, `/admin/calendar*`, `/admin/availability*`, `/admin/scheduling/blocks` | Lịch hẹn | Lịch hẹn › Danh sách / Lịch salon / Khả dụng / workflow | Calendar / operations board | `appointment.*`, `calendar.*`, `availability.*` | Bảng cuộn trong card; ngày/giờ theo timezone; form mobile một cột |
| `/admin/operations*`, `/admin/service-sessions*` | Vận hành salon | Lịch hẹn › Bảng vận hành | Operations board | `operations.*`, `walkin.*`, `service_session.*` | Hàng đợi ưu tiên, trạng thái rõ, không biến thành CRM pipeline |
| `/admin/customers`, `/admin/customers/new` | Customer directory | Khách hàng › Danh sách khách hàng | Directory | `customer.*`, tenant/branch/PII policy | Search có label; bảng inner-scroll; empty state có link tạo/tra cứu thật |
| `/admin/customers/:customerId`, `/admin/customers/:customerId/engagement` | Customer 360 & care | Khách hàng › Customer 360 / Liên hệ & chăm sóc | Master-detail + timeline | customer read, engagement timeline, PII; child route được match trước generic customer | Hero + activity timeline; right rail stack ở breakpoint hẹp; route customer không rơi về directory |
| `/admin/benefits*`, `/admin/benefits/customers*`, `/admin/loyalty*`, `/admin/membership*`, `/admin/packages*`, `/admin/vouchers*`, `/admin/gift-cards*`, `/admin/customer-credit`, `/admin/stored-value*` | Quyền lợi & stored value | Khách hàng › Loyalty / Membership / Gói / Voucher / Gift Card / Store Credit | Benefit hub, customer detail, ledger/reconciliation | Domain permission tương ứng; không trộn Gift Card, Customer Credit, Loyalty | Multi-currency tách account; no fake expiry/lock; KPI từ read model; inspector được chọn từ bảng |
| `/admin/catalog/services*`, `/admin/catalog/categories`, `/admin/catalog/skills`, `/admin/catalog/resources`, `/admin/catalog/resource-types` | Dịch vụ | Dịch vụ › Danh mục / Nhóm / Kỹ năng / Tài nguyên | Directory + service detail | `service.*`, `resource.*` | Bảng an toàn, object hiển thị label/name/code; detail chia tab thay vì JSON |
| `/admin/staff*`, `/admin/scheduling/shifts`, `/admin/scheduling/leave-requests`, `/admin/time-clock*`, `/admin/timesheets*`, `/admin/timesheet-periods`, `/admin/workforce*`, `/admin/payroll*`, `/admin/payout*` | Nhân sự | Nhân sự › Hồ sơ / Ca / Nghỉ / Chấm công / Bảng công / Bảng lương | Directory, approval inbox, payroll workbench | Staff/workforce/payroll/payout permissions + branch | Action theo state/version; mobile card; PII và pay profile có scope riêng |
| `/admin/pos*`, `/admin/pos/checkout*`, `/admin/pos/orders*`, `/admin/pos/registers`, `/admin/pos/cash-sessions*` | POS & bán hàng | POS & Bán hàng › Quầy / Đơn hàng / Thu ngân / Ca thu ngân | POS workspace + order detail + cash session | `pos.*`, `payment.*`, `cash_session.*` | Touch target tối thiểu 44px; payment state từ server; không client-side financial arithmetic |
| `/admin/inventory*` | Kho | Kho & Tài sản › Kho hàng | Inventory operations | `inventory.*`, branch scope | Stock/lot/transfer/receipt phân biệt; filter/table theo domain; export thật nếu có |
| `/admin/procurement*` | Mua hàng & công nợ | Kho & Tài sản › Mua hàng | Procurement workbench + approval inbox | `procurement.*`, `vendor.*` | Vendor/request/PO/bill tách archetype; version/idempotency; không bảng JSON |
| `/admin/assets*` | Tài sản cố định | Kho & Tài sản › Tài sản | Asset register + approval | `asset.*` | Register, depreciation, maintenance, disposal tách phần; bằng chứng bất biến |
| `/admin/financial*`, `/admin/refunds*`, `/admin/credit-notes*`, `/admin/accounting*`, `/admin/commission*`, `/admin/payouts`, `/admin/payout-reconciliation` | Tài chính & kế toán | Tài chính & Kế toán › Tài chính / Hóa đơn / Thanh toán / Đối soát / Kế toán / Hoàn tiền / Credit Note / Hoa hồng / Chi trả | Financial workbench, ledger, reconciliation, approval | financial/invoice/payment/refund/accounting permissions; tenant + branch | Không raw JSON; tiền integer minor units; status/evidence/link nguồn; terminal state không có action giả |
| `/admin/marketing/campaigns`, `/admin/marketing/campaigns/:campaignId`, `/admin/marketing/segments` | Marketing khách hàng | Marketing & CSKH › Marketing khách hàng / Nhóm khách hàng | Campaign hub + master-detail + guided creation | marketing campaign/segment/report + consent/suppression | Email-only; snapshot vs preview rõ; không open/click/booking/revenue giả; scheduled không có pause |
| `/admin/communications`, `/admin/communications/messages`, `/admin/communications/rules`, `/admin/communications/templates`, `/admin/communications/suppressions` | Email & giao tiếp | Marketing & CSKH › Email & giao tiếp | Technical delivery workspace | communication message/template/rule permissions | SENT/FAILED/SUPPRESSED/CANCELLED đúng semantics; attempts bounded; không show provider secret/open tracking |
| `/admin/customer-care`, `/admin/customers/:customerId/engagement`, `/admin/service-recovery*`, `/admin/reviews`, `/admin/review-requests` | CSKH & recovery | Khách hàng › Liên hệ & chăm sóc; Marketing & CSKH › Recovery / Đánh giá | Care hub + scoped timeline + recovery workbench | customer care/engagement/review/recovery permissions; branch-safe | Call/note/follow-up chỉ hiển thị khi persisted; follow-up overdue derived; internal note privacy |
| `/admin/analytics*`, `/admin/financial/reports` và report subroutes | Báo cáo & phân tích | Báo cáo & Phân tích › Tổng quan / Doanh thu / Lịch hẹn / Nhân sự / Chất lượng dữ liệu | Analytics command center + report | analytics/report permission | Chart có bảng accessible; duplicate label key phải kèm index; freshness rõ; không aggregate từ page hiện tại |
| `/admin/organization*`, `/admin/team*`, `/admin/security*`, `/admin/profile` | Cài đặt | Cài đặt › Salon / Chi nhánh / Tài khoản & quyền / Phiên đăng nhập | Settings / policy | organization/branch/user/role/security | Form có error/dirty state; permission-aware; mobile một cột |
| `/platform/*` | Nền tảng | Nền tảng › Tenant / Gói & bảng giá / Thanh toán / Quyền hỗ trợ | Platform admin workbench | Chỉ `PLATFORM_SUPER_ADMIN` và support grant semantics hiện có | Tách khỏi salon data; không bypass support access; nhóm ẩn hoàn toàn nếu không có role |

## Nguyên tắc shell và điều hướng

- `AdminShell` là shell duy nhất. Không render secondary “sprint/wave” navigation trong page.
- Registry canonical là `navigationRegistry`; renderer chỉ nhận cây hai cấp, lọc child trước rồi mới giữ parent.
- Active child chọn theo match dài nhất, nên deep link `/admin/financial/invoices/:id` đánh dấu `Hóa đơn`, không đồng thời đánh dấu `Tài chính` như hai mục.
- Sidebar desktop hỗ trợ compact flyout; mobile dùng accordion, Escape đóng menu và khóa body scroll khi menu mở.
- Parent singleton dùng link; parent nhiều child dùng button với `aria-expanded`/`aria-controls`; child active dùng `aria-current="page"`.
- Mọi action/button chính có target tối thiểu 44px; table chỉ scroll bên trong card, không tạo page-level horizontal overflow.

## Route inventory — static literals được giữ nguyên

```text
/admin/accounting
/admin/accounting/books
/admin/accounting/journals
/admin/accounting/open-items
/admin/accounting/periods
/admin/accounting/posting-candidates
/admin/accounting/reconciliation
/admin/accounting/reconciliation/exceptions
/admin/accounting/reconciliation/statement-lines
/admin/accounting/reports
/admin/accounting/statement-snapshots
/admin/analytics
/admin/analytics/bookings
/admin/analytics/data-quality
/admin/analytics/sales
/admin/analytics/staff
/admin/appointments
/admin/appointments/new
/admin/assets
/admin/assets/candidates
/admin/assets/capitalization
/admin/assets/counts
/admin/assets/depreciation
/admin/assets/disposals
/admin/assets/impairments
/admin/assets/inspections
/admin/assets/maintenance
/admin/assets/reports
/admin/assets/transfers
/admin/availability
/admin/availability/search
/admin/benefits
/admin/benefits/customers
/admin/benefits/liability
/admin/benefits/reports
/admin/billing
/admin/billing/history
/admin/billing/invoices
/admin/billing/invoices/detail
/admin/billing/payment-methods
/admin/billing/plans
/admin/billing/subscription
/admin/billing/usage
/admin/calendar
/admin/calendar/day
/admin/calendar/week
/admin/catalog/categories
/admin/catalog/resource-types
/admin/catalog/resources
/admin/catalog/services
/admin/catalog/skills
/admin/commission
/admin/commission/adjustments
/admin/commission/entries
/admin/commission/periods
/admin/commission/rules
/admin/commission/rules/new
/admin/communications
/admin/communications/messages
/admin/communications/rules
/admin/communications/suppressions
/admin/communications/templates
/admin/credit-notes
/admin/customer-care
/admin/customer-credit
/admin/customers
/admin/customers/new
/admin/dashboard
/admin/financial
/admin/financial/commission
/admin/financial/exports
/admin/financial/invoices
/admin/financial/net-sales
/admin/financial/payments
/admin/financial/reconciliation
/admin/financial/refunds
/admin/gift-cards
/admin/gift-cards/issuance
/admin/gift-cards/products
/admin/inventory
/admin/inventory/adjustments
/admin/inventory/alerts
/admin/inventory/counts
/admin/inventory/items
/admin/inventory/locations
/admin/inventory/lots
/admin/inventory/purchase-orders
/admin/inventory/receipts
/admin/inventory/reports
/admin/inventory/service-recipes
/admin/inventory/stock
/admin/inventory/suppliers
/admin/inventory/transfers
/admin/inventory/valuation
/admin/loyalty
/admin/loyalty/adjustments
/admin/loyalty/customers
/admin/loyalty/programs
/admin/marketing
/admin/marketing/campaigns
/admin/marketing/segments
/admin/membership
/admin/membership/customers
/admin/membership/tiers
/admin/operations
/admin/operations/board
/admin/operations/walk-ins
/admin/operations/walk-ins/new
/admin/organization
/admin/organization/branches
/admin/organization/general
/admin/packages
/admin/packages/catalog
/admin/packages/entitlements
/admin/payout
/admin/payout-reconciliation
/admin/payouts
/admin/payroll
/admin/payroll/calendars
/admin/payroll/exceptions
/admin/payroll/periods
/admin/payroll/reports
/admin/payroll/runs
/admin/payroll/statements
/admin/pos
/admin/pos/cash-sessions
/admin/pos/cash-sessions/open
/admin/pos/checkout
/admin/pos/new
/admin/pos/orders
/admin/pos/registers
/admin/procurement
/admin/procurement/ap
/admin/procurement/credit-notes
/admin/procurement/payment-proposals
/admin/procurement/purchase-orders
/admin/procurement/purchase-requests
/admin/procurement/receipts
/admin/procurement/returns
/admin/procurement/vendor-bills
/admin/procurement/vendor-payments
/admin/procurement/vendors
/admin/profile
/admin/refunds
/admin/refunds/new
/admin/review-requests
/admin/reviews
/admin/scheduling
/admin/scheduling/blocks
/admin/scheduling/leave-requests
/admin/scheduling/shifts
/admin/security
/admin/security/sessions
/admin/service-recovery
/admin/service-sessions
/admin/staff
/admin/staff/list
/admin/staff/new
/admin/stored-value
/admin/stored-value/adjustments
/admin/stored-value/exceptions
/admin/stored-value/legal-policies
/admin/stored-value/liability
/admin/stored-value/reconciliation
/admin/support-access
/admin/team
/admin/team/users
/admin/time-clock
/admin/time-clock/devices
/admin/time-clock/exceptions
/admin/time-clock/sessions
/admin/timesheet-periods
/admin/timesheets
/admin/vouchers
/admin/vouchers/campaigns
/admin/vouchers/codes
/admin/workforce
/admin/workforce/compliance
/admin/workforce/policies
/admin/workforce/reports
/platform/break-glass
/platform/discounts
/platform/dunning
/platform/invoices
/platform/payment-intents
/platform/payments
/platform/plans
/platform/prices
/platform/reconciliation
/platform/refunds
/platform/reports
/platform/support-access
/platform/support-access-grants
/platform/tenants
/platform/tenants/detail
/platform/tenants/entitlements
/platform/tenants/invoices
/platform/tenants/subscription
```

## Dynamic route families

Các pattern detail dưới đây được giữ nguyên và không làm phát sinh cấp sidebar mới: `/admin/customers/:customerId`, `/admin/customers/:customerId/engagement`, `/admin/benefits/customers/:customerId`, `/admin/loyalty/customers/:customerId`, `/admin/membership/customers/:customerId`, `/admin/packages/catalog/:id`, `/admin/packages/entitlements/:id`, `/admin/vouchers/campaigns/:id`, `/admin/gift-cards/:id`, `/admin/staff/:id`, `/admin/staff/:id/pay-profile`, `/admin/catalog/services/:id`, `/admin/pos/checkout/:id`, `/admin/pos/orders/:id`, `/admin/pos/orders/:id/benefits`, `/admin/pos/orders/:id/stored-value`, `/admin/pos/orders/:id/gift-card`, `/admin/pos/cash-sessions/:id`, `/admin/pos/cash-sessions/:id/close`, `/admin/refunds/:id`, `/admin/credit-notes/:id`, `/admin/reviews/:id`, `/admin/service-recovery/:id`, cùng các pattern detail đối soát, payroll, payout và tenant/platform đang được route matcher hiện tại xử lý.
