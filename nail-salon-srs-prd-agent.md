# SRS/PRD — NAIL SALON MANAGEMENT PLATFORM

**Version:** 1.0  
**Document type:** Software Requirements Specification + Product Requirements Document  
**Audience:** Product Owner, Business Analyst, UI/UX Designer, Tech Lead, Backend/Frontend/Mobile Engineer, QA, DevOps, AI Coding Agent  
**Product model:** Multi-tenant SaaS, multi-branch, mobile-first, realtime, offline-aware  
**Primary stack:** Next.js, React Native/Expo, NestJS, PostgreSQL, Redis, WebSocket, background workers

---

# 0. HƯỚNG DẪN CHO AGENT

Agent phải coi tài liệu này là nguồn yêu cầu chính. Khi triển khai:

1. Không hardcode nghiệp vụ có thể cấu hình theo salon hoặc chi nhánh.
2. Mọi dữ liệu nghiệp vụ phải có `tenant_id`; dữ liệu theo chi nhánh phải có `branch_id`.
3. PostgreSQL là nguồn dữ liệu chính; Redis không được là nguồn sự thật duy nhất.
4. Mọi thao tác tài chính, đặt lịch, voucher, package và kho phải hỗ trợ idempotency.
5. Mọi thao tác quan trọng phải có audit log.
6. UI phải mobile-first, hỗ trợ optimistic update và rollback khi máy chủ từ chối.
7. Realtime chỉ dùng để đồng bộ trạng thái; dữ liệu cuối cùng luôn được xác thực lại từ API/database.
8. Không xóa vật lý dữ liệu giao dịch; dùng trạng thái, soft delete hoặc bút toán điều chỉnh.
9. Mỗi module phải có unit test, integration test và end-to-end test cho luồng chính.
10. Mỗi sprint phải hoàn thành theo Definition of Done ở cuối tài liệu.

---

# 1. TỔNG QUAN SẢN PHẨM

## 1.1. Tầm nhìn

Xây dựng nền tảng quản lý tiệm nail thống nhất cho chủ tiệm, quản lý, lễ tân, kỹ thuật viên và khách hàng, bao phủ toàn bộ vòng đời:

> Thu hút khách → Đặt lịch → Check-in → Xếp hàng → Thực hiện dịch vụ → Thanh toán → Tính tip/hoa hồng → Chăm sóc lại → Khách quay lại.

## 1.2. Mục tiêu sản phẩm

- Vận hành một salon hoặc chuỗi salon không cần sổ ngoài.
- Cho phép quản lý toàn bộ hoạt động trên Web, Mobile và Tablet.
- Tạo cảm giác thao tác tức thì thông qua cache, optimistic UI, WebSocket và đồng bộ nền.
- Ngăn trùng lịch, trùng thanh toán và sai lệch hoa hồng.
- Cho phép mở rộng thành SaaS bán cho nhiều salon.
- Hỗ trợ tiếng Việt và tiếng Anh từ kiến trúc ban đầu.

## 1.3. Ngoài phạm vi phiên bản MVP

- Kế toán tài chính đầy đủ theo chuẩn doanh nghiệp.
- Quản lý nhân sự chuyên sâu như bảo hiểm, thuế thu nhập cá nhân.
- Marketplace kết nối nhiều salon.
- AI tự động thực hiện hành động tài chính không cần phê duyệt.
- Hệ thống camera hoặc chấm công giám sát liên tục.

---

# 2. KPI VÀ CHỈ TIÊU NGHIỆM THU

## 2.1. KPI sản phẩm

- Tỷ lệ lịch được quản lý hoàn toàn trên hệ thống: ≥ 95%.
- Tỷ lệ giao dịch POS không cần sửa thủ công: ≥ 99%.
- Tỷ lệ booking trùng hợp lệ: 0%.
- Tỷ lệ khách quay lại có thể đo được theo cohort.
- Tỷ lệ no-show giảm sau khi bật nhắc lịch.
- Chủ tiệm xem được doanh thu, lịch và hiệu suất nhân viên từ Mobile.

## 2.2. SLO hiệu năng

| Chỉ số | Mục tiêu |
|---|---:|
| Phản hồi chạm nút trên UI | < 50 ms |
| Optimistic state xuất hiện | < 100 ms |
| Điều hướng màn hình có cache | < 150 ms |
| API đọc thông thường p95 | < 300 ms |
| API ghi thông thường p95 | < 500 ms |
| Đồng bộ realtime giữa thiết bị p95 | < 1 giây |
| Tìm khung giờ p95 | < 700 ms |
| Mở lịch hôm nay từ cache Mobile | < 500 ms |
| Availability giai đoạn đầu | 99,9% |

“Instant” được hiểu là không chặn trải nghiệm người dùng; không cam kết độ trễ mạng bằng 0.

---

# 3. VAI TRÒ VÀ PHÂN QUYỀN

## 3.1. Vai trò hệ thống

- `PLATFORM_SUPER_ADMIN`
- `SALON_OWNER`
- `BRANCH_MANAGER`
- `RECEPTIONIST`
- `CASHIER`
- `NAIL_TECHNICIAN`
- `ACCOUNTANT`
- `MARKETING_STAFF`
- `CUSTOMER`

## 3.2. Ma trận quyền tối thiểu

| Nghiệp vụ | Owner | Manager | Receptionist | Technician | Accountant | Marketing |
|---|---:|---:|---:|---:|---:|---:|
| Quản lý chi nhánh | ✓ | Giới hạn | — | — | — | — |
| Quản lý dịch vụ/giá | ✓ | Theo quyền | Xem | Xem | Xem | Xem |
| Tạo/sửa booking | ✓ | ✓ | ✓ | Hạn chế | — | — |
| Check-in khách | ✓ | ✓ | ✓ | Theo quyền | — | — |
| Bắt đầu/hoàn thành dịch vụ | ✓ | ✓ | ✓ | ✓ | — | — |
| POS/thanh toán | ✓ | ✓ | ✓ | Hạn chế | Xem | — |
| Refund | ✓ | Theo hạn mức | Yêu cầu duyệt | — | Theo quyền | — |
| Xem doanh thu | ✓ | Theo chi nhánh | Hạn chế | Cá nhân | ✓ | Hạn chế |
| Quản lý hoa hồng | ✓ | Theo quyền | — | Xem cá nhân | ✓ | — |
| Voucher/campaign | ✓ | Theo quyền | Áp dụng | — | Xem | ✓ |
| Xuất dữ liệu | ✓ | Theo quyền | — | — | ✓ | Theo quyền |

## 3.3. Policy tài chính

- Giảm giá vượt hạn mức phải tạo approval request.
- Người tạo refund không được tự duyệt nếu salon bật dual control.
- Hóa đơn đã thanh toán không được sửa trực tiếp.
- Kỳ hoa hồng đã khóa chỉ thay đổi bằng adjustment.

---

# 4. PHẠM VI CHỨC NĂNG VÀ YÊU CẦU

## 4.1. Authentication & Identity

### FR-AUTH-001 — Đăng nhập

Hỗ trợ email/password, số điện thoại/OTP và phiên đăng nhập an toàn.

**Acceptance criteria**

- Có refresh token rotation.
- Có giới hạn đăng nhập sai.
- Có thể thu hồi phiên từ xa.
- Chủ tiệm và quản lý có thể bật MFA.

### FR-AUTH-002 — Quản lý thiết bị

- Lưu tên thiết bị, nền tảng, phiên bản app, lần truy cập cuối.
- Cho phép đăng xuất thiết bị cụ thể.

### FR-AUTH-003 — Phân quyền

- Kiểm tra quyền ở backend, không chỉ ẩn nút trên UI.
- Quyền gắn với tenant và branch scope.

---

## 4.2. Tenant, Salon và Chi nhánh

### FR-ORG-001 — Tenant isolation

Mọi truy vấn phải có tenant context. Tenant A không được đọc hoặc ghi dữ liệu tenant B.

### FR-ORG-002 — Cấu hình salon

- Tên, logo, màu thương hiệu.
- Ngôn ngữ mặc định.
- Tiền tệ.
- Múi giờ.
- Chính sách đặt lịch.
- Chính sách hủy.
- Cấu hình thuế.

### FR-ORG-003 — Cấu hình chi nhánh

- Địa chỉ, hotline, giờ mở cửa.
- Ngày nghỉ.
- Bảng giá riêng.
- Kho riêng.
- Nhân viên và tài nguyên riêng.

---

## 4.3. Service Catalog

### FR-SVC-001 — Danh mục dịch vụ

Hỗ trợ category, subcategory, service, variant, add-on, combo và package.

### FR-SVC-002 — Thông tin dịch vụ

Mỗi dịch vụ có:

- Tên đa ngôn ngữ.
- Giá cơ bản.
- Thời lượng.
- Thời gian chuẩn bị và dọn dẹp.
- Mức đặt cọc.
- Thuế.
- Kỹ năng yêu cầu.
- Tài nguyên yêu cầu.
- Định mức vật tư.
- Quy tắc hoa hồng mặc định.

### FR-SVC-003 — Giá theo chi nhánh và thời điểm

- Giá có ngày hiệu lực.
- Lịch đã xác nhận giữ snapshot giá.
- Thay đổi giá không làm thay đổi hóa đơn/lịch cũ.

---

## 4.4. Nhân viên, kỹ năng và ca làm

### FR-STAFF-001 — Hồ sơ nhân viên

- Thông tin cá nhân.
- Vai trò.
- Chi nhánh.
- Kỹ năng.
- Dịch vụ được làm.
- Giá riêng theo cấp độ.
- Hoa hồng.

### FR-STAFF-002 — Lịch làm việc

- Ca lặp lại.
- Nghỉ giữa ca.
- Làm nhiều chi nhánh.
- Nghỉ phép.
- Đổi ca.

### FR-STAFF-003 — Chấm công

- Mobile check-in/out.
- Kiosk PIN/QR.
- Chỉnh sửa có audit và lý do.

---

## 4.5. Booking & Availability

### FR-BOOK-001 — Tạo booking

Nguồn booking:

- Admin Web.
- Reception Tablet.
- Owner/Staff Mobile.
- Customer booking page/app.
- QR/link chiến dịch.
- Walk-in chuyển đổi.

### FR-BOOK-002 — Trạng thái booking

```text
DRAFT
SLOT_HELD
PENDING_CONFIRMATION
CONFIRMED
CHECKED_IN
IN_SERVICE
COMPLETED
CHECKED_OUT
PAID
CANCELLED_BY_CUSTOMER
CANCELLED_BY_SALON
NO_SHOW
RESCHEDULED
EXPIRED
```

### FR-BOOK-003 — Công cụ tìm khung giờ

Khung giờ dựa trên:

- Giờ mở cửa.
- Ca nhân viên.
- Nghỉ phép.
- Kỹ năng.
- Dịch vụ.
- Buffer.
- Tài nguyên dùng chung.
- Capacity.
- Booking hiện có.

### FR-BOOK-004 — Chống trùng lịch

- UI đánh dấu slot đang giữ theo realtime.
- Backend kiểm tra lại trong transaction.
- Booking chỉ xác nhận khi staff/resource đều khả dụng.
- Khi xung đột, trả về các slot thay thế.

### FR-BOOK-005 — Giữ chỗ

- Slot hold có TTL.
- Hết TTL tự giải phóng.
- Thanh toán cọc thành công chuyển booking sang confirmed.

### FR-BOOK-006 — Đổi và hủy lịch

- Lưu toàn bộ lịch sử.
- Tính phí theo chính sách.
- Gửi thông báo.
- Không tạo bản ghi khách trùng.

### FR-BOOK-007 — Booking nhóm

- Nhiều khách, nhiều dịch vụ.
- Dịch vụ song song/nối tiếp.
- Nhiều nhân viên.
- Một hoặc nhiều hóa đơn.

---

## 4.6. Walk-in Queue

### FR-QUEUE-001 — Thêm khách vãng lai

- Tìm khách theo điện thoại.
- Tạo hồ sơ nhanh.
- Chọn dịch vụ.
- Ước tính thời gian chờ.

### FR-QUEUE-002 — Hàng chờ realtime

- Thứ tự.
- Thời gian chờ.
- Nhân viên mong muốn.
- Mức ưu tiên.
- Trạng thái khách.

### FR-QUEUE-003 — Gọi khách

- Push/SMS/in-app khi gần đến lượt.
- Chuyển waitlist thành appointment/service session.

---

## 4.7. Customer CRM

### FR-CRM-001 — Hồ sơ khách

- Thông tin liên hệ.
- Ngôn ngữ.
- Ngày sinh.
- Dị ứng/lưu ý.
- Sở thích.
- Nhân viên yêu thích.
- Ảnh trước/sau.
- Lịch sử booking và thanh toán.
- Điểm, voucher, package.

### FR-CRM-002 — Chống trùng và hợp nhất

- Phát hiện theo số điện thoại/email chuẩn hóa.
- Merge giữ toàn bộ lịch sử.
- Merge phải có audit.

### FR-CRM-003 — Segmentation

- Khách mới.
- Khách quay lại.
- VIP.
- Có nguy cơ rời bỏ.
- Sinh nhật.
- Lâu ngày chưa quay lại.
- Hay hủy/no-show.

---

## 4.8. Check-in và Service Session

### FR-EXEC-001 — Check-in

- Lễ tân, QR hoặc kiosk.
- Xác nhận khách, dịch vụ, nhân viên, voucher và package.

### FR-EXEC-002 — Phiên dịch vụ

Trạng thái:

- `NOT_STARTED`
- `IN_PROGRESS`
- `PAUSED`
- `COMPLETED`
- `CANCELLED`
- `REWORK`

### FR-EXEC-003 — Dịch vụ phát sinh

- Hiển thị giá trước khi xác nhận.
- Cập nhật timeline.
- Cảnh báo ảnh hưởng booking sau.
- Cập nhật hóa đơn, kho và hoa hồng.

### FR-EXEC-004 — Nhiều nhân viên

- Gán nhân viên chính/phụ.
- Chia theo tỷ lệ hoặc thời gian.
- Tổng tỷ lệ phải hợp lệ.

---

## 4.9. POS, Hóa đơn và Thanh toán

### FR-POS-001 — Hóa đơn

Dòng hóa đơn hỗ trợ:

- Dịch vụ.
- Add-on.
- Sản phẩm.
- Combo/package.
- Phụ phí.
- Thuế.
- Giảm giá.
- Voucher.
- Tip.
- Đặt cọc.

### FR-POS-002 — Trạng thái hóa đơn

```text
DRAFT
OPEN
PARTIALLY_PAID
PAID
VOIDED
PARTIALLY_REFUNDED
REFUNDED
```

### FR-POS-003 — Thanh toán

- Tiền mặt.
- Thẻ.
- Chuyển khoản.
- Ví điện tử.
- Gift card.
- Store credit.
- Điểm.
- Split payment.

### FR-POS-004 — Chia hóa đơn

- Theo người.
- Theo dòng dịch vụ.
- Chia đều.
- Tùy chỉnh số tiền.

### FR-POS-005 — Refund

- Chọn dòng hoặc số tiền.
- Lý do.
- Approval theo hạn mức.
- Điều chỉnh doanh thu, tip, điểm, hoa hồng và kho nếu cần.

### FR-POS-006 — Kết ca

- Tiền đầu ca.
- Tiền dự kiến.
- Tiền thực tế.
- Chênh lệch.
- Khóa ca.

---

## 4.10. Tip, Hoa hồng và Kỳ thanh toán

### FR-COM-001 — Tip

- Theo nhân viên.
- Theo nhóm.
- Tiền mặt/thẻ.
- Chia theo tỷ lệ hoặc thời gian.

### FR-COM-002 — Commission rule

- Phần trăm.
- Số tiền cố định.
- Theo dịch vụ.
- Theo cấp nhân viên.
- Theo bậc doanh số.
- Theo trước/sau giảm giá.
- Theo bán sản phẩm.

### FR-COM-003 — Commission period

- Draft.
- Review.
- Dispute.
- Locked.
- Paid.

Refund sau khi khóa kỳ phải tạo adjustment ở kỳ tiếp theo hoặc theo cấu hình.

---

## 4.11. Voucher, Loyalty và Package

### FR-VOU-001 — Voucher

- Fixed amount.
- Percentage.
- Free service/add-on.
- Buy X get Y.
- Điều kiện theo dịch vụ, chi nhánh, khách, thời gian, giá trị hóa đơn.

### FR-LOY-001 — Loyalty

- Tích điểm.
- Tiêu điểm.
- Hạng thành viên.
- Hết hạn điểm.
- Lịch sử bút toán điểm.

### FR-PKG-001 — Package

- Số lượt.
- Giá trị.
- Ngày hết hạn.
- Chi nhánh áp dụng.
- Chuyển nhượng.
- Theo dõi số dư chưa thực hiện.

---

## 4.12. Kho hàng

### FR-INV-001 — Sản phẩm và vật tư

- Retail product.
- Consumable.
- Equipment.
- Batch/expiry nếu cần.

### FR-INV-002 — Stock movement

Không chỉnh trực tiếp tồn kho. Mọi thay đổi tạo movement:

- Purchase receipt.
- Sale.
- Service consumption.
- Transfer.
- Count adjustment.
- Damage.
- Return.

### FR-INV-003 — Cảnh báo tồn

- Minimum stock.
- Low stock.
- Hết hạn.
- Đề xuất nhập hàng.

---

## 4.13. Marketing Automation

### FR-MKT-001 — Template

- Email.
- SMS.
- Push.
- In-app.
- Biến động như tên khách, lịch, voucher, booking link.

### FR-MKT-002 — Trigger

- Booking created/confirmed.
- Nhắc lịch.
- No-show follow-up.
- Sau dịch vụ.
- Sinh nhật.
- Voucher/package sắp hết hạn.
- Khách lâu ngày chưa quay lại.

### FR-MKT-003 — Consent

- Chỉ gửi theo kênh đã đồng ý.
- Có unsubscribe.
- Có quiet hours.
- Có chống gửi trùng.

---

## 4.14. Dashboard và Báo cáo

### FR-RPT-001 — Dashboard realtime

- Doanh thu hôm nay.
- Booking.
- Khách đang chờ.
- Khách đang phục vụ.
- Công suất nhân viên.
- Hủy/no-show.
- Cảnh báo kho.

### FR-RPT-002 — Báo cáo vận hành

- Utilization.
- Fill rate.
- Wait time.
- Service duration variance.
- On-time rate.
- Rebooking rate.

### FR-RPT-003 — Báo cáo tài chính

- Gross sales.
- Discount.
- Refund.
- Net sales.
- Tax.
- Tip.
- Payment method.
- Theo nhân viên/dịch vụ/chi nhánh.

### FR-RPT-004 — Báo cáo CRM

- New vs returning.
- Lifetime value.
- Churn risk.
- Campaign conversion.
- Voucher effectiveness.

---

# 5. SITEMAP ADMIN WEB

```text
/admin
├── dashboard
│   ├── overview
│   ├── live-operations
│   └── alerts
├── calendar
│   ├── day
│   ├── week
│   ├── month
│   ├── waitlist
│   └── blocked-times
├── appointments
│   ├── all
│   ├── create
│   ├── pending-confirmation
│   ├── cancelled
│   └── no-show
├── customers
│   ├── all
│   ├── segments
│   ├── duplicate-review
│   ├── memberships
│   ├── packages
│   └── customer/:id
├── pos
│   ├── open-orders
│   ├── checkout
│   ├── invoices
│   ├── payments
│   ├── refunds
│   └── cash-sessions
├── services
│   ├── categories
│   ├── services
│   ├── variants-addons
│   ├── pricing
│   ├── combos
│   └── resources
├── staff
│   ├── employees
│   ├── skills
│   ├── schedules
│   ├── attendance
│   ├── leave-requests
│   ├── commissions
│   └── payroll-periods
├── inventory
│   ├── products
│   ├── stock-by-branch
│   ├── movements
│   ├── transfers
│   ├── purchase-orders
│   ├── stock-counts
│   └── alerts
├── marketing
│   ├── campaigns
│   ├── automations
│   ├── templates
│   ├── vouchers
│   ├── audiences
│   └── message-history
├── loyalty
│   ├── programs
│   ├── tiers
│   ├── points-ledger
│   ├── gift-cards
│   └── packages
├── reports
│   ├── revenue
│   ├── operations
│   ├── staff-performance
│   ├── customers
│   ├── marketing
│   ├── commissions
│   └── inventory
├── approvals
│   ├── discounts
│   ├── refunds
│   ├── commission-adjustments
│   ├── stock-adjustments
│   └── data-exports
├── organization
│   ├── salon-profile
│   ├── branches
│   ├── business-hours
│   ├── taxes
│   ├── payment-methods
│   ├── booking-policies
│   └── localization
├── users-access
│   ├── users
│   ├── roles
│   ├── permissions
│   ├── devices
│   └── audit-logs
├── integrations
│   ├── email-sms
│   ├── payment-gateways
│   ├── webhooks
│   ├── accounting-export
│   └── api-keys
└── settings
    ├── notifications
    ├── appearance
    ├── security
    ├── data-retention
    └── subscription
```

## 5.1. Quy tắc UX Admin

- Calendar là màn hình vận hành trung tâm.
- POS tối ưu cho tablet và màn hình cảm ứng.
- Mọi bảng phải có filter, sort, saved view và export theo quyền.
- Mọi form lớn phải autosave draft cục bộ.
- Action quan trọng có confirm và hiển thị hậu quả.
- Dashboard không tải toàn bộ báo cáo cùng lúc; ưu tiên dữ liệu realtime và lazy loading.

---

# 6. DANH SÁCH MÀN HÌNH MOBILE

## 6.1. Owner App

1. Splash/Session Restore.
2. Login/MFA.
3. Home Dashboard.
4. Revenue Today.
5. Branch Comparison.
6. Live Operations.
7. Booking Calendar.
8. Appointment Detail.
9. Customer Detail.
10. Staff Status.
11. Staff Performance.
12. Approval Inbox.
13. Discount Approval.
14. Refund Approval.
15. Inventory Alerts.
16. Notification Center.
17. Reports Snapshot.
18. Settings.
19. Device Sessions.
20. Profile/Security.

## 6.2. Staff App

1. Login/PIN/Biometric Unlock.
2. Today Timeline.
3. Week Schedule.
4. Appointment Detail.
5. Customer Summary.
6. Start Service.
7. Pause/Resume Service.
8. Add Service/Add-on.
9. Add Notes.
10. Before/After Photos.
11. Complete Service.
12. Waitlist Assignment.
13. Clock In/Out.
14. Leave Request.
15. Shift Swap Request.
16. Tips Summary.
17. Commission Summary.
18. Notifications.
19. Offline Sync Queue.
20. Profile.

## 6.3. Reception Tablet/Mobile

1. Live Calendar.
2. Staff Columns.
3. Walk-in Queue.
4. Quick Customer Search.
5. Quick Customer Create.
6. Create Booking.
7. Reschedule Booking.
8. Check-in.
9. Service Status Board.
10. POS Cart.
11. Apply Voucher.
12. Split Payment.
13. Receipt.
14. Cash Session.
15. End-of-day Summary.

## 6.4. Customer App/PWA

1. Home/Salon Selection.
2. Branch Selection.
3. Service Category.
4. Service Detail.
5. Staff Selection.
6. Available Slots.
7. Booking Review.
8. Deposit Payment.
9. Booking Confirmation.
10. My Appointments.
11. Reschedule/Cancel.
12. Membership.
13. Points History.
14. Vouchers.
15. Packages.
16. Rebook Previous Service.
17. Review Service.
18. Profile/Consent.
19. Notification Preferences.

---

# 7. LUỒNG NGHIỆP VỤ CỐT LÕI

## 7.1. Khách đặt lịch online

```text
Chọn chi nhánh
→ Chọn dịch vụ
→ Chọn nhân viên hoặc Any Staff
→ API trả slot khả dụng
→ Giữ slot có TTL
→ Khách nhập/xác nhận thông tin
→ Thanh toán cọc nếu có
→ Backend transaction xác nhận slot
→ Tạo appointment + price snapshot
→ Phát AppointmentConfirmed
→ Gửi thông báo nền
```

## 7.2. Lễ tân xử lý walk-in

```text
Tìm khách
→ Tạo mới nếu chưa có
→ Chọn dịch vụ
→ Tìm nhân viên phù hợp
→ Thêm waitlist
→ Realtime cập nhật bảng chờ
→ Gọi khách
→ Check-in
→ Tạo service session
```

## 7.3. Thực hiện và thanh toán

```text
Technician bắt đầu dịch vụ
→ Reception cập nhật realtime
→ Thêm add-on nếu có
→ Technician hoàn thành
→ POS lấy appointment items
→ Áp voucher/package/discount
→ Chọn tip
→ Thanh toán
→ Tạo commission entries
→ Trừ kho
→ Cập nhật dashboard
→ Gửi hóa đơn và lời cảm ơn
```

## 7.4. Refund

```text
Chọn invoice/payment
→ Chọn dòng/số tiền
→ Nhập lý do
→ Kiểm tra hạn mức
→ Tạo approval nếu cần
→ Payment gateway refund
→ Tạo refund ledger
→ Điều chỉnh invoice, commission, loyalty, inventory
→ Audit
```

---

# 8. API CONTRACT

## 8.1. Chuẩn chung

**Base path**

```text
/api/v1
```

**Headers**

```http
Authorization: Bearer <token>
X-Tenant-Id: <tenant_uuid>
X-Branch-Id: <branch_uuid>
X-Request-Id: <uuid>
Idempotency-Key: <uuid>   # bắt buộc với write quan trọng
Accept-Language: vi-VN
```

## 8.2. Response envelope

### Thành công

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-10T03:00:00Z"
  }
}
```

### Danh sách phân trang

```json
{
  "data": [],
  "meta": {
    "cursor": "next_cursor",
    "hasMore": true,
    "limit": 50
  }
}
```

### Lỗi

```json
{
  "error": {
    "code": "BOOKING_SLOT_CONFLICT",
    "message": "Khung giờ vừa được người khác đặt.",
    "details": {
      "suggestedSlots": []
    },
    "requestId": "uuid"
  }
}
```

## 8.3. Mã lỗi chuẩn

- `UNAUTHORIZED`
- `FORBIDDEN`
- `TENANT_SCOPE_VIOLATION`
- `VALIDATION_ERROR`
- `RESOURCE_NOT_FOUND`
- `VERSION_CONFLICT`
- `BOOKING_SLOT_CONFLICT`
- `BOOKING_POLICY_VIOLATION`
- `PAYMENT_DECLINED`
- `DUPLICATE_OPERATION`
- `VOUCHER_INVALID`
- `PACKAGE_INSUFFICIENT_BALANCE`
- `INVENTORY_INSUFFICIENT`
- `APPROVAL_REQUIRED`
- `RATE_LIMITED`

## 8.4. Auth endpoints

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/auth/login` | Đăng nhập |
| POST | `/auth/otp/request` | Yêu cầu OTP |
| POST | `/auth/otp/verify` | Xác minh OTP |
| POST | `/auth/refresh` | Làm mới token |
| POST | `/auth/logout` | Đăng xuất phiên hiện tại |
| GET | `/auth/sessions` | Danh sách thiết bị |
| DELETE | `/auth/sessions/:id` | Thu hồi phiên |
| POST | `/auth/mfa/setup` | Thiết lập MFA |
| POST | `/auth/mfa/verify` | Xác minh MFA |

## 8.5. Organization endpoints

| Method | Endpoint |
|---|---|
| GET | `/organization` |
| PATCH | `/organization` |
| GET | `/branches` |
| POST | `/branches` |
| GET | `/branches/:id` |
| PATCH | `/branches/:id` |
| GET | `/branches/:id/business-hours` |
| PUT | `/branches/:id/business-hours` |
| GET | `/branches/:id/settings` |
| PATCH | `/branches/:id/settings` |

## 8.6. Service endpoints

| Method | Endpoint |
|---|---|
| GET | `/service-categories` |
| POST | `/service-categories` |
| GET | `/services` |
| POST | `/services` |
| GET | `/services/:id` |
| PATCH | `/services/:id` |
| POST | `/services/:id/prices` |
| GET | `/services/:id/prices` |
| POST | `/services/:id/addons` |
| POST | `/services/:id/resources` |
| POST | `/services/:id/materials` |

## 8.7. Staff endpoints

| Method | Endpoint |
|---|---|
| GET | `/staff` |
| POST | `/staff` |
| GET | `/staff/:id` |
| PATCH | `/staff/:id` |
| GET | `/staff/:id/schedule` |
| PUT | `/staff/:id/schedule` |
| POST | `/staff/:id/skills` |
| GET | `/staff/:id/commissions` |
| POST | `/time-entries/clock-in` |
| POST | `/time-entries/clock-out` |
| GET | `/leave-requests` |
| POST | `/leave-requests` |
| POST | `/leave-requests/:id/approve` |

## 8.8. Availability và Booking endpoints

| Method | Endpoint | Ghi chú |
|---|---|---|
| POST | `/availability/search` | Tìm slot |
| POST | `/slot-holds` | Giữ slot |
| DELETE | `/slot-holds/:id` | Giải phóng |
| GET | `/appointments` | Filter theo thời gian/trạng thái |
| POST | `/appointments` | Idempotent |
| GET | `/appointments/:id` | Chi tiết |
| PATCH | `/appointments/:id` | Có version |
| POST | `/appointments/:id/confirm` | Xác nhận |
| POST | `/appointments/:id/reschedule` | Đổi lịch |
| POST | `/appointments/:id/cancel` | Hủy |
| POST | `/appointments/:id/check-in` | Check-in |
| POST | `/appointments/:id/no-show` | No-show |

### Ví dụ tìm slot

```json
POST /api/v1/availability/search
{
  "branchId": "uuid",
  "serviceItems": [
    { "serviceId": "uuid", "quantity": 1 }
  ],
  "preferredStaffId": null,
  "dateFrom": "2026-07-10",
  "dateTo": "2026-07-17",
  "partySize": 1
}
```

### Ví dụ tạo booking

```json
POST /api/v1/appointments
{
  "slotHoldId": "uuid",
  "customerId": "uuid",
  "branchId": "uuid",
  "source": "CUSTOMER_WEB",
  "items": [
    {
      "serviceId": "uuid",
      "staffId": "uuid",
      "startAt": "2026-07-12T10:00:00+07:00"
    }
  ],
  "notes": "Khách muốn màu nude"
}
```

## 8.9. Customer endpoints

| Method | Endpoint |
|---|---|
| GET | `/customers` |
| POST | `/customers` |
| GET | `/customers/:id` |
| PATCH | `/customers/:id` |
| GET | `/customers/:id/history` |
| GET | `/customers/:id/appointments` |
| GET | `/customers/:id/invoices` |
| GET | `/customers/:id/vouchers` |
| GET | `/customers/:id/packages` |
| POST | `/customers/duplicates/search` |
| POST | `/customers/merge` |

## 8.10. Queue và Service Session endpoints

| Method | Endpoint |
|---|---|
| GET | `/waitlist` |
| POST | `/waitlist` |
| PATCH | `/waitlist/:id` |
| POST | `/waitlist/:id/call` |
| POST | `/waitlist/:id/convert` |
| GET | `/service-sessions` |
| POST | `/service-sessions` |
| POST | `/service-sessions/:id/start` |
| POST | `/service-sessions/:id/pause` |
| POST | `/service-sessions/:id/resume` |
| POST | `/service-sessions/:id/add-item` |
| POST | `/service-sessions/:id/complete` |
| POST | `/service-sessions/:id/media` |

## 8.11. POS và Payment endpoints

| Method | Endpoint |
|---|---|
| GET | `/invoices` |
| POST | `/invoices` |
| GET | `/invoices/:id` |
| PATCH | `/invoices/:id` |
| POST | `/invoices/:id/items` |
| POST | `/invoices/:id/discounts` |
| POST | `/invoices/:id/apply-voucher` |
| POST | `/invoices/:id/split` |
| POST | `/payments` |
| GET | `/payments/:id` |
| POST | `/refunds` |
| GET | `/cash-sessions` |
| POST | `/cash-sessions/open` |
| POST | `/cash-sessions/:id/close` |

### Ví dụ thanh toán idempotent

```json
POST /api/v1/payments
{
  "invoiceId": "uuid",
  "method": "CASH",
  "amount": 550000,
  "currency": "VND",
  "tipAllocations": [
    { "staffId": "uuid", "amount": 50000 }
  ]
}
```

## 8.12. Voucher, loyalty, package endpoints

| Method | Endpoint |
|---|---|
| GET | `/vouchers` |
| POST | `/vouchers` |
| POST | `/vouchers/validate` |
| POST | `/vouchers/:id/redeem` |
| GET | `/loyalty/programs` |
| POST | `/loyalty/programs` |
| GET | `/loyalty/accounts/:customerId` |
| POST | `/loyalty/adjustments` |
| GET | `/packages` |
| POST | `/packages` |
| POST | `/package-usages` |

## 8.13. Inventory endpoints

| Method | Endpoint |
|---|---|
| GET | `/products` |
| POST | `/products` |
| GET | `/inventory` |
| GET | `/stock-movements` |
| POST | `/stock-movements` |
| POST | `/stock-transfers` |
| POST | `/stock-counts` |
| POST | `/purchase-orders` |
| POST | `/purchase-orders/:id/receive` |

## 8.14. Marketing endpoints

| Method | Endpoint |
|---|---|
| GET | `/message-templates` |
| POST | `/message-templates` |
| GET | `/campaigns` |
| POST | `/campaigns` |
| POST | `/campaigns/:id/estimate-audience` |
| POST | `/campaigns/:id/launch` |
| POST | `/campaigns/:id/cancel` |
| GET | `/automations` |
| POST | `/automations` |
| GET | `/message-deliveries` |

## 8.15. Reporting endpoints

| Method | Endpoint |
|---|---|
| GET | `/dashboard/overview` |
| GET | `/dashboard/live` |
| GET | `/reports/revenue` |
| GET | `/reports/operations` |
| GET | `/reports/staff-performance` |
| GET | `/reports/customers` |
| GET | `/reports/marketing` |
| GET | `/reports/inventory` |
| POST | `/reports/exports` |

---

# 9. REALTIME VÀ EVENT CONTRACT

## 9.1. WebSocket connection

```text
wss://<host>/realtime
```

Client phải xác thực token và join room:

- `tenant:{tenantId}`
- `branch:{branchId}`
- `staff:{staffId}`
- `user:{userId}`

## 9.2. Event envelope

```json
{
  "eventId": "uuid",
  "eventType": "AppointmentUpdated",
  "tenantId": "uuid",
  "branchId": "uuid",
  "entityId": "uuid",
  "version": 8,
  "occurredAt": "2026-07-10T03:00:00Z",
  "correlationId": "uuid",
  "payload": {}
}
```

## 9.3. Realtime events tối thiểu

- `AppointmentCreated`
- `AppointmentUpdated`
- `AppointmentCancelled`
- `SlotHeld`
- `SlotReleased`
- `WaitlistUpdated`
- `CustomerCheckedIn`
- `ServiceSessionStarted`
- `ServiceSessionUpdated`
- `ServiceSessionCompleted`
- `InvoiceUpdated`
- `PaymentCompleted`
- `RefundCompleted`
- `DashboardMetricUpdated`
- `InventoryLevelChanged`
- `ApprovalRequested`
- `ApprovalResolved`

## 9.4. Reconnect rule

- Exponential backoff.
- Sau reconnect, client gửi `lastEventId`.
- Nếu không replay được, client refetch các query bị ảnh hưởng.
- Event version nhỏ hơn hoặc bằng version local phải bỏ qua.

---

# 10. DATABASE SCHEMA

## 10.1. Quy ước

- Primary key: UUID/ULID.
- Thời gian lưu UTC; hiển thị theo branch timezone.
- Tiền lưu số nguyên nhỏ nhất của tiền tệ hoặc decimal chuẩn.
- Mọi bảng nghiệp vụ có `tenant_id`.
- Bảng theo chi nhánh có `branch_id`.
- Bảng mutable có `version` để optimistic concurrency.
- Trường chuẩn: `created_at`, `updated_at`, `created_by`, `updated_by`.

## 10.2. Organization

### `tenants`

- `id`
- `name`
- `status`
- `default_locale`
- `default_currency`
- `subscription_plan_id`
- timestamps

### `salons`

- `id`
- `tenant_id`
- `name`
- `legal_name`
- `logo_url`
- `timezone`
- `currency`
- `settings_json`

### `branches`

- `id`
- `tenant_id`
- `salon_id`
- `name`
- `code`
- `address_json`
- `phone`
- `timezone`
- `currency`
- `status`

### `business_hours`

- `id`
- `tenant_id`
- `branch_id`
- `day_of_week`
- `open_time`
- `close_time`
- `is_closed`

## 10.3. Identity và access

### `users`

- `id`
- `tenant_id` nullable với platform admin
- `email_normalized`
- `phone_normalized`
- `password_hash`
- `status`
- `last_login_at`

### `roles`

- `id`
- `tenant_id`
- `code`
- `name`
- `is_system`

### `permissions`

- `id`
- `code`
- `description`

### `role_permissions`

- `role_id`
- `permission_id`

### `user_roles`

- `user_id`
- `role_id`
- `branch_id` nullable

### `device_sessions`

- `id`
- `user_id`
- `refresh_token_hash`
- `device_name`
- `platform`
- `app_version`
- `last_seen_at`
- `revoked_at`

## 10.4. Staff

### `staff_profiles`

- `id`
- `tenant_id`
- `user_id` nullable
- `employee_code`
- `display_name`
- `level`
- `status`
- `hire_date`
- `termination_date`

### `staff_branches`

- `staff_id`
- `branch_id`
- `is_primary`

### `skills`

- `id`
- `tenant_id`
- `name`

### `staff_skills`

- `staff_id`
- `skill_id`
- `proficiency_level`

### `shifts`

- `id`
- `tenant_id`
- `branch_id`
- `staff_id`
- `start_at`
- `end_at`
- `status`
- `recurrence_rule` nullable

### `leave_requests`

- `id`
- `tenant_id`
- `staff_id`
- `start_at`
- `end_at`
- `reason`
- `status`
- `approved_by`

### `time_entries`

- `id`
- `tenant_id`
- `branch_id`
- `staff_id`
- `clock_in_at`
- `clock_out_at`
- `source`
- `adjustment_reason`

## 10.5. Service catalog

### `service_categories`

- `id`
- `tenant_id`
- `parent_id` nullable
- `name_json`
- `sort_order`
- `status`

### `services`

- `id`
- `tenant_id`
- `category_id`
- `code`
- `name_json`
- `description_json`
- `default_duration_min`
- `prep_time_min`
- `cleanup_time_min`
- `deposit_type`
- `deposit_value`
- `tax_code`
- `status`

### `service_prices`

- `id`
- `tenant_id`
- `service_id`
- `branch_id` nullable
- `staff_level` nullable
- `amount`
- `currency`
- `effective_from`
- `effective_to` nullable

### `service_addons`

- `id`
- `tenant_id`
- `service_id`
- `addon_service_id`
- `is_required`

### `resources`

- `id`
- `tenant_id`
- `branch_id`
- `type`
- `name`
- `capacity`
- `status`

### `service_resources`

- `service_id`
- `resource_type`
- `quantity`

## 10.6. Customers

### `customers`

- `id`
- `tenant_id`
- `customer_code`
- `full_name`
- `phone_normalized`
- `email_normalized`
- `date_of_birth`
- `preferred_locale`
- `preferred_branch_id`
- `preferred_staff_id`
- `status`
- `notes`

### `customer_consents`

- `id`
- `tenant_id`
- `customer_id`
- `channel`
- `purpose`
- `granted`
- `granted_at`
- `revoked_at`

### `customer_tags`

- `customer_id`
- `tag_id`

### `customer_media`

- `id`
- `tenant_id`
- `customer_id`
- `appointment_id`
- `type`
- `storage_key`
- `metadata_json`

## 10.7. Booking

### `slot_holds`

- `id`
- `tenant_id`
- `branch_id`
- `customer_id` nullable
- `expires_at`
- `status`
- `payload_json`

### `appointments`

- `id`
- `tenant_id`
- `branch_id`
- `customer_id`
- `source`
- `status`
- `start_at`
- `end_at`
- `party_size`
- `notes`
- `price_snapshot_total`
- `currency`
- `version`

### `appointment_items`

- `id`
- `tenant_id`
- `appointment_id`
- `service_id`
- `service_name_snapshot`
- `price_snapshot`
- `duration_snapshot_min`
- `start_at`
- `end_at`
- `status`

### `appointment_assignments`

- `id`
- `tenant_id`
- `appointment_item_id`
- `staff_id`
- `role`
- `allocation_percent`

### `appointment_resources`

- `appointment_item_id`
- `resource_id`
- `quantity`

### `appointment_status_history`

- `id`
- `tenant_id`
- `appointment_id`
- `from_status`
- `to_status`
- `reason`
- `changed_by`
- `changed_at`

### `waitlist_entries`

- `id`
- `tenant_id`
- `branch_id`
- `customer_id`
- `requested_services_json`
- `preferred_staff_id`
- `priority`
- `estimated_wait_min`
- `status`
- `joined_at`

## 10.8. Service execution

### `service_sessions`

- `id`
- `tenant_id`
- `branch_id`
- `appointment_item_id`
- `status`
- `started_at`
- `completed_at`
- `actual_duration_min`
- `version`

### `session_staff`

- `service_session_id`
- `staff_id`
- `role`
- `started_at`
- `ended_at`
- `allocation_percent`

### `session_notes`

- `id`
- `tenant_id`
- `service_session_id`
- `note_type`
- `content`
- `created_by`

## 10.9. POS và payment

### `invoices`

- `id`
- `tenant_id`
- `branch_id`
- `customer_id`
- `appointment_id` nullable
- `invoice_number`
- `status`
- `subtotal`
- `discount_total`
- `tax_total`
- `tip_total`
- `grand_total`
- `paid_total`
- `currency`
- `version`

### `invoice_items`

- `id`
- `tenant_id`
- `invoice_id`
- `item_type`
- `reference_id`
- `description_snapshot`
- `quantity`
- `unit_price`
- `discount_amount`
- `tax_amount`
- `line_total`
- `staff_id` nullable

### `payments`

- `id`
- `tenant_id`
- `branch_id`
- `invoice_id`
- `method`
- `provider`
- `provider_reference`
- `amount`
- `currency`
- `status`
- `idempotency_key`
- `paid_at`

### `refunds`

- `id`
- `tenant_id`
- `payment_id`
- `invoice_id`
- `amount`
- `reason_code`
- `reason_text`
- `status`
- `approved_by`
- `provider_reference`

### `tips`

- `id`
- `tenant_id`
- `invoice_id`
- `payment_id`
- `staff_id`
- `amount`
- `method`

### `cash_sessions`

- `id`
- `tenant_id`
- `branch_id`
- `opened_by`
- `opened_at`
- `opening_amount`
- `closed_at`
- `expected_amount`
- `actual_amount`
- `variance_amount`
- `status`

## 10.10. Commission

### `commission_rules`

- `id`
- `tenant_id`
- `branch_id` nullable
- `staff_id` nullable
- `service_id` nullable
- `rule_type`
- `rule_config_json`
- `effective_from`
- `effective_to`

### `commission_entries`

- `id`
- `tenant_id`
- `staff_id`
- `invoice_item_id`
- `service_session_id` nullable
- `base_amount`
- `commission_amount`
- `rule_snapshot_json`
- `status`
- `period_id`

### `commission_periods`

- `id`
- `tenant_id`
- `start_date`
- `end_date`
- `status`
- `locked_at`
- `paid_at`

### `commission_adjustments`

- `id`
- `tenant_id`
- `staff_id`
- `period_id`
- `amount`
- `reason`
- `approved_by`

## 10.11. Voucher, loyalty, package

### `vouchers`

- `id`
- `tenant_id`
- `code`
- `type`
- `value`
- `conditions_json`
- `start_at`
- `end_at`
- `usage_limit_total`
- `usage_limit_per_customer`
- `status`

### `voucher_redemptions`

- `id`
- `tenant_id`
- `voucher_id`
- `customer_id`
- `invoice_id`
- `discount_amount`
- `redeemed_at`

### `loyalty_accounts`

- `id`
- `tenant_id`
- `customer_id`
- `program_id`
- `balance`
- `tier_id`

### `loyalty_transactions`

- `id`
- `tenant_id`
- `account_id`
- `type`
- `points`
- `reference_type`
- `reference_id`
- `expires_at`

### `packages`

- `id`
- `tenant_id`
- `customer_id`
- `package_definition_id`
- `remaining_units`
- `remaining_value`
- `expires_at`
- `status`

### `package_usages`

- `id`
- `tenant_id`
- `package_id`
- `invoice_item_id`
- `units_used`
- `value_used`
- `used_at`

## 10.12. Inventory

### `products`

- `id`
- `tenant_id`
- `sku`
- `name`
- `type`
- `unit`
- `retail_price`
- `cost_price`
- `track_inventory`
- `status`

### `stock_locations`

- `id`
- `tenant_id`
- `branch_id`
- `name`

### `inventory_balances`

- `tenant_id`
- `location_id`
- `product_id`
- `quantity_on_hand`
- `quantity_reserved`
- `version`

### `stock_movements`

- `id`
- `tenant_id`
- `location_id`
- `product_id`
- `movement_type`
- `quantity`
- `unit_cost`
- `reference_type`
- `reference_id`
- `occurred_at`

### `purchase_orders`

- `id`
- `tenant_id`
- `branch_id`
- `supplier_id`
- `status`
- `total_cost`
- `ordered_at`
- `received_at`

## 10.13. Marketing và hệ thống

### `message_templates`

- `id`
- `tenant_id`
- `channel`
- `name`
- `subject`
- `content`
- `locale`
- `status`

### `campaigns`

- `id`
- `tenant_id`
- `name`
- `channel`
- `audience_filter_json`
- `template_id`
- `scheduled_at`
- `status`

### `message_deliveries`

- `id`
- `tenant_id`
- `campaign_id` nullable
- `customer_id`
- `channel`
- `destination_hash`
- `status`
- `provider_reference`
- `sent_at`
- `opened_at`
- `failed_reason`

### `audit_logs`

- `id`
- `tenant_id`
- `branch_id` nullable
- `actor_user_id`
- `action`
- `entity_type`
- `entity_id`
- `before_json`
- `after_json`
- `reason`
- `ip_address`
- `device_id`
- `created_at`

### `idempotency_keys`

- `id`
- `tenant_id`
- `key`
- `request_hash`
- `response_status`
- `response_body_json`
- `expires_at`

### `outbox_events`

- `id`
- `tenant_id`
- `event_type`
- `aggregate_type`
- `aggregate_id`
- `payload_json`
- `status`
- `created_at`
- `published_at`

## 10.14. Index và constraint bắt buộc

- Unique: `(tenant_id, phone_normalized)` khi phone không null.
- Unique: `(tenant_id, code)` cho voucher/service code.
- Unique: `(tenant_id, idempotency_key)` cho payments/critical commands.
- Index booking: `(tenant_id, branch_id, start_at, end_at, status)`.
- Index staff assignment: `(tenant_id, staff_id, start_at, end_at)` thông qua appointment item/session.
- Index customer search: phone, email, trigram full name.
- Index invoice: `(tenant_id, branch_id, created_at, status)`.
- Check: allocation percent tổng hợp hợp lệ ở application layer và transaction.
- Exclusion/locking strategy để chống staff/resource overlap.

---

# 11. OFFLINE-FIRST VÀ OPTIMISTIC UI

## 11.1. Dữ liệu cache trên Mobile

- Lịch hôm nay và 7 ngày gần nhất.
- Hồ sơ khách liên quan lịch hiện tại.
- Danh mục dịch vụ và bảng giá hiện hành.
- Ca làm và thông báo.
- Hàng đợi thao tác chưa đồng bộ.

## 11.2. Local operation schema

```json
{
  "operationId": "uuid",
  "type": "SERVICE_SESSION_COMPLETE",
  "entityId": "uuid",
  "baseVersion": 7,
  "payload": {},
  "createdAtDevice": "2026-07-10T10:00:00+07:00",
  "syncStatus": "PENDING"
}
```

## 11.3. Quy tắc optimistic

Cho phép optimistic:

- Chuyển trạng thái UI cục bộ.
- Ghi chú.
- Ảnh đang upload.
- Mark notification read.
- Thay đổi tùy chọn cá nhân.

Cần server confirmation trước khi cam kết:

- Booking.
- Thanh toán.
- Refund.
- Voucher/package redemption.
- Kho.
- Kỳ hoa hồng.

## 11.4. Conflict handling

- `409 VERSION_CONFLICT`: refetch entity, hiển thị so sánh và cho người dùng thử lại.
- `409 BOOKING_SLOT_CONFLICT`: rollback và đề xuất slot khác.
- `422 POLICY_VIOLATION`: rollback và giải thích điều kiện.

---

# 12. KIẾN TRÚC VÀ REPO

## 12.1. Kiến trúc đề xuất

- Modular monolith cho backend giai đoạn đầu.
- Event-driven boundaries.
- Background worker riêng.
- WebSocket gateway riêng process khi cần scale.
- Read model/cache cho dashboard.

## 12.2. Monorepo

```text
apps/
  admin-web/
  booking-web/
  owner-mobile/
  staff-mobile/
  api/
  worker/

packages/
  ui-web/
  ui-mobile/
  domain-types/
  api-client/
  validation/
  auth/
  localization/
  config/
  observability/
  testing/

infra/
  docker/
  migrations/
  terraform/
  monitoring/

docs/
  adr/
  api/
  product/
```

## 12.3. Backend module boundaries

```text
identity
organization
staff
service-catalog
availability
booking
queue
customer
service-execution
pos
payment
commission
inventory
voucher
loyalty
marketing
notification
reporting
approval
audit
subscription
integration
```

---

# 13. BẢO MẬT VÀ TUÂN THỦ

- TLS toàn bộ kết nối.
- Mã hóa dữ liệu lưu trữ.
- Không lưu thẻ thanh toán thô.
- Signed URL cho media.
- RBAC + branch scope + financial limit policy.
- Rate limit auth, public booking và voucher validation.
- Audit refund, discount, permission, export, merge customer, inventory adjustment.
- Backup tự động và kiểm thử restore.
- Data retention cấu hình.
- Consent marketing theo từng kênh.
- Export dữ liệu cá nhân theo quyền.

---

# 14. BACKLOG THEO SPRINT

Giả định sprint 2 tuần, đội gồm Tech Lead, Backend, Web, Mobile, QA và UI/UX. Các sprint có thể chạy song song theo năng lực đội, nhưng dependency phải được tôn trọng.

## Sprint 0 — Discovery, UX foundation và kiến trúc

**Mục tiêu:** Khóa phạm vi MVP, luồng chính và nền tảng kỹ thuật.

### Product/BA

- Event storming cho booking, POS, payment, commission.
- Chốt vai trò và permission matrix.
- Chốt quy tắc pricing, cancellation, deposit.
- Chốt wireframe Calendar, POS, Staff Today.

### Engineering

- Khởi tạo monorepo.
- CI lint/test/build.
- Docker local environment.
- PostgreSQL, Redis.
- ADR cho multi-tenant, idempotency, outbox, realtime.
- Design token và localization foundation.

### QA

- Test strategy.
- Test data strategy.
- Base E2E framework.

### Exit criteria

- Chạy được skeleton Web/API/Mobile.
- CI xanh.
- Có ERD v1 và OpenAPI skeleton.

---

## Sprint 1 — Identity, Tenant và Branch

**Mục tiêu:** Đăng nhập, tenant isolation và cấu hình tổ chức.

### Backend

- Users, roles, permissions, sessions.
- Tenant middleware/guard.
- Organization/branch CRUD.
- Business hours.
- Audit base.

### Web

- Login/MFA UI.
- Organization settings.
- Branch list/detail.
- User/role list cơ bản.

### Mobile

- Login.
- Session restore.
- Secure token storage.

### QA

- Tenant isolation tests.
- Auth/session tests.

### Exit criteria

- Không thể truy cập chéo tenant.
- Owner tạo được branch và user.

---

## Sprint 2 — Service Catalog và Staff

**Mục tiêu:** Cấu hình dịch vụ, giá, kỹ năng và nhân viên.

### Backend

- Category/service/price/resource.
- Staff profile/skill/branch.
- Shift và leave request nền tảng.

### Web

- Service management.
- Pricing screens.
- Staff list/detail.
- Schedule editor cơ bản.

### Mobile

- Staff profile.
- Today schedule placeholder.

### QA

- Price effective-date tests.
- Permission tests.

### Exit criteria

- Tạo được dịch vụ có giá theo branch.
- Gán kỹ năng và ca cho nhân viên.

---

## Sprint 3 — Availability Engine và Calendar Read

**Mục tiêu:** Tính được slot và hiển thị calendar nhanh.

### Backend

- Availability search.
- Staff/resource conflict detection.
- Slot hold TTL.
- Calendar read API tối ưu.

### Web

- Day/week calendar.
- Staff columns.
- Filters.
- Loading skeleton và cache.

### Mobile

- Today timeline read-only.
- Cache lịch hôm nay.

### QA

- Overlap scenarios.
- Timezone/DST scenarios.
- Load test availability.

### Exit criteria

- Slot trả đúng theo giờ làm, skill và booking giả lập.
- Calendar p95 đạt mục tiêu trên dữ liệu test.

---

## Sprint 4 — Booking CRUD và Realtime

**Mục tiêu:** Tạo, sửa, đổi, hủy và đồng bộ booking.

### Backend

- Appointment aggregate.
- Status machine.
- Confirm/reschedule/cancel.
- Idempotency.
- Outbox events.
- WebSocket events.

### Web

- Create/edit booking drawer.
- Drag/drop reschedule.
- Conflict rollback.
- Realtime calendar update.

### Mobile

- Appointment detail.
- Staff notification.

### QA

- Hai client đặt cùng slot.
- Reconnect/refetch.
- Duplicate request.

### Exit criteria

- Không có booking trùng hợp lệ.
- Hai màn hình cập nhật trong vòng một giây.

---

## Sprint 5 — Customer CRM và Walk-in Queue

**Mục tiêu:** Quản lý khách và vận hành khách vãng lai.

### Backend

- Customer CRUD/search.
- Duplicate detection/merge.
- Customer history.
- Waitlist.

### Web/Tablet

- Customer list/detail.
- Quick create.
- Waitlist board realtime.

### Mobile

- Customer summary.
- Queue assignment.

### QA

- Merge customer integrity.
- Queue ordering/filtering.

### Exit criteria

- Lễ tân thêm walk-in trong vài thao tác.
- Lịch sử khách không mất khi merge.

---

## Sprint 6 — Check-in và Service Execution

**Mục tiêu:** Theo dõi dịch vụ từ check-in đến hoàn thành.

### Backend

- Check-in.
- Service session state machine.
- Session staff allocation.
- Notes/media metadata.

### Web

- Live operation board.
- Check-in.
- Service status.

### Mobile

- Start/pause/resume/complete.
- Add note/photo.
- Optimistic state và offline queue cơ bản.

### QA

- State transition tests.
- Offline/retry tests.

### Exit criteria

- Staff hoàn thành dịch vụ trên Mobile.
- Reception nhìn thấy trạng thái realtime.

---

## Sprint 7 — POS và Thanh toán

**Mục tiêu:** Tạo hóa đơn và nhận thanh toán chính xác.

### Backend

- Invoice, items, taxes, discounts.
- Payments.
- Idempotency.
- Split payment.
- Cash session.

### Web/Tablet

- POS cart.
- Checkout.
- Split payment.
- Receipt.
- Open/close cash session.

### Mobile Owner

- Payment notification.
- Revenue card.

### QA

- Totals/rounding.
- Duplicate payment.
- Partial payment.

### Exit criteria

- Hoàn thành end-to-end appointment → paid invoice.
- Không tạo payment trùng khi retry.

---

## Sprint 8 — Refund, Tip và Commission

**Mục tiêu:** Hoàn tiền, chia tip và tính hoa hồng.

### Backend

- Refund workflow.
- Approval base.
- Tip allocation.
- Commission rules/entries/periods.

### Web

- Refund request/approval.
- Commission rule editor.
- Period review/lock.

### Mobile

- Staff tips/commission summary.
- Owner approval inbox.

### QA

- Refund adjustment.
- Commission split.
- Locked period behavior.

### Exit criteria

- Refund điều chỉnh đúng invoice và commission.
- Nhân viên chỉ xem số liệu cá nhân.

---

## Sprint 9 — Voucher, Loyalty và Package

**Mục tiêu:** Khuyến mãi và giữ chân khách.

### Backend

- Voucher validation/redemption.
- Loyalty ledger.
- Package balance/usage.

### Web

- Voucher builder.
- Loyalty program.
- Package management.

### Customer Web/Mobile

- Vouchers.
- Points.
- Packages.

### QA

- Concurrent redemption.
- Expiry/limit.
- Refund rollback.

### Exit criteria

- Voucher không vượt usage limit.
- Điểm và package dùng theo ledger.

---

## Sprint 10 — Inventory

**Mục tiêu:** Quản lý sản phẩm và vật tư.

### Backend

- Product, locations, balances.
- Stock movements.
- Transfer/count/PO receive.
- Service consumption.

### Web

- Inventory dashboard.
- Movements.
- Transfers.
- Stock count.
- Low-stock alerts.

### QA

- Concurrency stock.
- Negative inventory policy.
- Count adjustment audit.

### Exit criteria

- Không chỉnh tồn trực tiếp.
- Mọi thay đổi truy vết được.

---

## Sprint 11 — Marketing và Notification Automation

**Mục tiêu:** Nhắc lịch và chăm sóc khách tự động.

### Backend/Worker

- Message templates.
- Notification jobs.
- Trigger engine.
- Consent/quiet hours.
- Provider abstraction.

### Web

- Template editor.
- Campaign builder.
- Automation rules.
- Delivery history.

### Mobile

- Push notifications.
- Deep link.

### QA

- Duplicate suppression.
- Retry/dead-letter.
- Consent tests.

### Exit criteria

- Gửi được booking confirmation/reminder/thank-you.
- Không gửi khách đã unsubscribe.

---

## Sprint 12 — Dashboard, Reports và Production Hardening

**Mục tiêu:** Báo cáo quản trị, tối ưu hiệu năng và sẵn sàng pilot.

### Backend

- Dashboard read model.
- Reports.
- Export jobs.
- Observability.
- Rate limit.

### Web/Mobile

- Owner dashboard.
- Revenue/operations reports.
- Alerts.
- Error/offline states hoàn chỉnh.

### DevOps

- Staging/production.
- Backups.
- Monitoring/alerts.
- Load test.
- Disaster recovery drill.

### QA/UAT

- End-to-end regression.
- Security test.
- Pilot salon UAT.

### Exit criteria

- Salon pilot vận hành trọn ngày.
- Không cần sổ ngoài cho booking, dịch vụ và thanh toán.
- Đạt SLO trọng yếu.

---

# 15. USER STORY MẪU CHO AGENT

## US-BOOK-001 — Lễ tân tạo lịch

**As a** Receptionist  
**I want** tạo lịch cho khách theo dịch vụ và nhân viên  
**So that** salon có thể giữ chỗ chính xác.

### Acceptance criteria

```gherkin
Given khách hàng và dịch vụ hợp lệ
And nhân viên còn trống
When lễ tân xác nhận booking
Then appointment được tạo ở trạng thái CONFIRMED
And giá, thời lượng được snapshot
And calendar của các thiết bị liên quan cập nhật realtime
And audit log được tạo
```

```gherkin
Given hai người cùng xác nhận một slot
When request đến gần như đồng thời
Then chỉ một appointment được xác nhận
And request còn lại nhận BOOKING_SLOT_CONFLICT
And hệ thống trả slot thay thế
```

## US-POS-001 — Thanh toán hóa đơn

```gherkin
Given invoice OPEN có tổng tiền 550000 VND
When thu ngân thanh toán đủ bằng tiền mặt
Then payment COMPLETED được tạo đúng một lần
And invoice chuyển PAID
And dashboard doanh thu cập nhật
And commission entries được tạo
And receipt có thể in hoặc gửi
```

## US-MOB-001 — Staff hoàn thành dịch vụ khi mạng yếu

```gherkin
Given staff đã mở lịch hôm nay từ cache
And kết nối mạng tạm thời gián đoạn
When staff bấm hoàn thành dịch vụ
Then UI hiển thị trạng thái đang chờ đồng bộ
And operation được lưu vào local queue
When mạng trở lại
Then operation được gửi với operationId duy nhất
And server xử lý idempotent
And UI nhận trạng thái cuối cùng
```

---

# 16. TEST STRATEGY

## 16.1. Unit tests

- State machines.
- Pricing.
- Availability.
- Voucher conditions.
- Commission calculations.
- Invoice totals.

## 16.2. Integration tests

- PostgreSQL transactions.
- Tenant scope.
- Outbox.
- Redis locks/cache.
- Payment adapter sandbox.

## 16.3. End-to-end tests

1. Create salon → service → staff → shift → booking.
2. Walk-in → check-in → service → POS → payment.
3. Booking conflict hai client.
4. Refund có approval.
5. Voucher concurrent redemption.
6. Offline Mobile sync.
7. Cross-tenant access bị chặn.

## 16.4. Performance tests

- Availability search.
- Calendar load với nhiều staff.
- Booking write burst.
- WebSocket fan-out.
- Dashboard read.

---

# 17. DEFINITION OF DONE

Một story chỉ hoàn thành khi:

1. Có acceptance criteria rõ ràng.
2. Backend validation và permission đầy đủ.
3. Tenant/branch isolation được kiểm thử.
4. Có audit nếu là hành động quan trọng.
5. Có idempotency nếu là booking/financial/inventory command.
6. Có loading, empty, error và retry state.
7. Có responsive Mobile/Tablet/Desktop nếu thuộc Web.
8. Có optimistic update hoặc giải thích vì sao không dùng.
9. Có realtime event nếu dữ liệu ảnh hưởng màn hình khác.
10. Có migration và rollback plan.
11. Unit/integration/E2E tests liên quan đều xanh.
12. API được cập nhật vào OpenAPI.
13. Không có secret hoặc dữ liệu cá nhân trong log.
14. Có telemetry và error tracking.
15. QA xác nhận trên staging.

---

# 18. SEED DATA TỐI THIỂU

Agent phải cung cấp seed development:

- 1 tenant.
- 2 branches.
- 1 owner.
- 1 manager.
- 2 receptionists.
- 8 technicians với kỹ năng khác nhau.
- 6 service categories.
- 30 services.
- 20 customers.
- 40 appointments ở nhiều trạng thái.
- 10 products/vật tư.
- 3 voucher mẫu.
- 1 loyalty program.
- 2 commission rules.

Seed phải deterministic, có thể reset và không dùng dữ liệu thật.

---

# 19. TIÊU CHÍ MVP GO-LIVE

MVP được phép pilot khi:

- Owner, Manager, Receptionist và Technician đăng nhập đúng quyền.
- Quản lý được branch, service, price, staff và schedule.
- Tạo/đổi/hủy booking và chống trùng lịch.
- Walk-in và check-in hoạt động.
- Staff thực hiện dịch vụ trên Mobile.
- POS thanh toán, tip và hoa hồng hoạt động.
- Dashboard doanh thu cập nhật gần realtime.
- Audit, backup, monitoring và tenant isolation đã kiểm thử.
- Các luồng critical có E2E test.
- Có quy trình rollback deployment và restore database.

---

# 20. THỨ TỰ ƯU TIÊN THỰC THI CHO AGENT

1. Nền tảng tenant/auth/audit.
2. Dữ liệu service/staff/branch.
3. Availability và booking conflict safety.
4. Calendar realtime.
5. CRM và walk-in.
6. Service execution Mobile.
7. POS/payment.
8. Refund/tip/commission.
9. Voucher/loyalty/package.
10. Inventory.
11. Marketing automation.
12. Reporting và scale hardening.

Agent không được bắt đầu AI, marketing nâng cao hoặc custom branding trước khi các luồng booking, service execution và payment ổn định.

---

# 21. PHỤ LỤC YÊU CẦU ĐÃ PHÊ DUYỆT — CR-0001

**Trạng thái:** Approved with Conditions, ngày 10/07/2026. Phụ lục này là một phần của nguồn triển khai chính và không làm thay đổi phạm vi Sprint 0.

## 21.1. Booking và Service Execution

- `PARTIALLY_COMPLETED` là trạng thái tổng hợp do hệ thống suy ra cho booking nhiều item; client không được chuyển trực tiếp.
- Điều kiện: ít nhất một item hoàn thành, ít nhất một item chưa hoàn thành/đã hủy/không thể thực hiện, và booking chưa hoàn tất cuối cùng.
- Item/session giữ trạng thái riêng; lịch sử suy ra phải audit được. Triển khai trong Booking và Service Execution Sprint.

## 21.2. Pricing

- MVP: giá mặc định service theo tenant, giá service theo branch, ngày bắt đầu, ngày kết thúc tùy chọn, cấm chồng lấn cùng scope, snapshot vào appointment item khi xác nhận.
- Backend chọn đúng một base price và trả `pricingTrace`; discount/voucher áp dụng sau base price. Manual override cần quyền, lý do và audit.
- Advanced pricing và thứ tự `manual override → customer contract → campaign → branch+technician → branch+time → branch service → tenant default` là post-MVP.

## 21.3. Platform support

- Platform Super Admin không mặc định đọc dữ liệu nghiệp vụ tenant. Sprint 1 chỉ tạo policy boundary.
- Full Support Access Grant phải do Owner cấp, có scope/thời hạn/lý do, read-only mặc định, thu hồi ngay và audit; break-glass cần phê duyệt, thời hạn ngắn và cảnh báo Owner. Triển khai ở SaaS Administration Sprint.

## 21.4. Event contract và observability

- Mọi event mới từ Sprint 1 dùng envelope versioned gồm event/aggregate identity và version, tenant/branch, actor, source, correlation/causation/trace, data và schema version.
- Consumer idempotent theo `eventId`; event đã phát là bất biến; cấm secret/dữ liệu nhạy cảm không cần thiết.
- Sprint 1 observability baseline: structured redacted logging, request/correlation ID, error tracking, API/database latency, error rate, health/readiness, worker/queue/WebSocket và auth/security signals.

## 21.5. Phạm vi capability

- Review là capability trong CRM/Service Experience/Marketing, có thể là module trong monolith nhưng không là microservice MVP.
- Accounting MVP chỉ gồm reconciliation, revenue/tax/tip/refund/cash session/credit note/export trong Finance/Reporting; không xây general ledger hoặc AP/AR đầy đủ.
- Paid invoice bất biến; credit note và replacement invoice giữ reference/audit chain và idempotency, triển khai ở POS/Finance.

## 21.6. Idempotency và offline

- Gift-card issue/top-up/redeem/cancel/refund và commission lock/reopen/adjustment/payout batch bắt buộc idempotent trong sprint sở hữu.
- Offline envelope bổ sung operation/version, tenant/branch/user/device/session, client time, base version, payload và client app. Server xác minh context từ session và retry theo `operationId`.
- Không triển khai sớm advanced pricing, gift card, credit note, replacement invoice, review workflow, accounting nâng cao, full support impersonation hoặc `PARTIALLY_COMPLETED`.

## 21.7. Quyết định kỹ thuật Sprint 1

- Chuyển API skeleton sang NestJS Fastify trước khi controller mở rộng; kiểm chứng auth, cookie nếu dùng, multipart, rate limit, CORS, Swagger, WebSocket, error filter, request ID, integration và load smoke test.
- Event catalog, ADR và test/API/ERD phải được cập nhật trong đúng sprint sở hữu; không tạo trước bảng post-MVP.
