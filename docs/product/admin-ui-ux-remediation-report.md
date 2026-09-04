# NailSoft Admin UI — UX Remediation Report

## Checkpoint

- Base verified from `main`: `abcb6c5c13727e462cebb42b53ba401eea9da1df`.
- Scope: Admin shell hierarchy, route inventory, page archetypes, safe data presentation and visual polish.
- API, PostgreSQL schema, worker lifecycle and permission contracts: **không thay đổi** trong đợt này.
- Production deployment: **không thực hiện**.

## Vấn đề đã xử lý

1. Chuẩn hóa navigation thành một registry cây hai cấp. Parent được ẩn khi không còn child hợp lệ; child được lọc theo permission; deep link chọn child khớp cụ thể nhất.
2. `AdminShell` là shell duy nhất. Các page cũ không còn render secondary navigation theo sprint/wave.
3. Desktop có chế độ compact/flyout; mobile có accordion, Escape để đóng và body lock khi menu mở.
4. Các route tổng quát trước đây hiển thị raw JSON đã chuyển sang bảng có cột/nhãn an toàn, object chỉ hiển thị name/code/short reference, và trạng thái empty/error riêng.
5. Analytics và báo cáo Net Sales sửa lỗi React duplicate key khi nhiều dòng có cùng ngày; các key giờ dùng định danh ổn định kết hợp vị trí dòng, còn nhãn xu hướng giữ thêm chi nhánh để không làm mất ngữ cảnh.
6. Analytics command center hiển thị thêm phân bổ theo chi nhánh, chỉ số vận hành, phạm vi báo cáo và cảnh báo từ cùng response projection; không tạo số liệu trình diễn.
7. UI tổng quát đã dùng nhãn tiếng Việt, trạng thái nghiệp vụ được dịch tập trung, và không hiển thị thuật ngữ nội bộ Sprint/Wave/Foundation/Contract/Implemented cho người vận hành.
8. Những màn hình domain-sensitive vẫn giữ API hiện có, không tự tính số tiền, không tạo dữ liệu mẫu và không mở rộng quyền truy cập.

## Kết quả inventory

- 198 route literals tĩnh được kiểm kê từ source hiện tại, bao gồm alias cần giữ tương thích.
- 12 nhóm parent vận hành trong registry.
- 58 destination cấp hai; nhóm Nền tảng chỉ hiển thị cho `PLATFORM_SUPER_ADMIN`.
- Dynamic detail/workflow routes được ghi nhận theo pattern trong [route & archetype matrix](./admin-ui-route-archetype-matrix.md), không đưa thành cấp thứ ba của sidebar.
- 9 archetype chính được chuẩn hóa: command center, directory/workbench, calendar/operations, master-detail, approval inbox, ledger/reconciliation, guided form, settings/policy và technical delivery.

## Files chính đã thay đổi

- `apps/admin-web/lib/navigation-registry.ts`
- `apps/admin-web/lib/admin-shell.tsx`
- `apps/admin-web/app/styles.css`
- `apps/admin-web/lib/safe-data-view.tsx`
- `apps/admin-web/lib/sprint1-screen.tsx`
- `apps/admin-web/lib/sprint4-screen.tsx`
- `apps/admin-web/lib/sprint5-screen.tsx`
- `apps/admin-web/lib/sprint6-screen.tsx`
- `apps/admin-web/lib/sprint7-screen.tsx`
- `apps/admin-web/lib/sprint8-screen.tsx`
- `apps/admin-web/lib/sprint9-screen.tsx`
- `apps/admin-web/lib/sprint10-screen.tsx`
- `apps/admin-web/lib/sprint11-screen.tsx`
- `apps/admin-web/lib/sprint12-screen.tsx`
- `apps/admin-web/lib/sprint13-screen.tsx`
- `apps/admin-web/lib/sprint14-screen.tsx`
- `apps/admin-web/lib/sprint15-screen.tsx`
- `apps/admin-web/lib/sprint16-screen.tsx`
- `apps/admin-web/lib/sprint19-wave2-screen.tsx`
- `apps/admin-web/lib/sprint19-wave4/shared.tsx`
- `apps/admin-web/lib/sprint19-wave4/staff.tsx`
- `apps/admin-web/lib/sprint19-wave5-assets.tsx`
- `apps/admin-web/lib/sprint19-wave5-inventory.tsx`
- `apps/admin-web/lib/sprint19-wave5-procurement.tsx`
- `apps/admin-web/lib/sprint19-wave6/analytics.tsx`
- `apps/admin-web/lib/financial/net-sales-page.tsx`
- `apps/admin-web/lib/sprint19-wave6/banking.tsx`
- `apps/admin-web/lib/sprint19-wave6/shared.tsx`
- `apps/admin-web/lib/sprint19-wave6/support-access.tsx`
- `apps/admin-web/app/page.tsx`
- `apps/admin-web/app/admin/design-system/gallery-content.tsx`
- `packages/ui-web/src/index.tsx`
- `tests/contract/sprint19-navigation-registry.test.ts`

## Kiểm tra đã chạy

- `pnpm --filter @nailsoft/admin-web typecheck`: **PASS**.
- `pnpm --filter @nailsoft/admin-web lint`: **PASS**.
- `pnpm --filter @nailsoft/admin-web build`: **PASS**.
- `pnpm --filter @nailsoft/api typecheck`: **PASS**.
- `pnpm --filter @nailsoft/worker typecheck`: **PASS**.
- `pnpm test:unit`: **PASS** — 66 files, 218 tests.
- `pnpm test:contract`: **PASS** — 27 files, 63 tests.
- Wave 0 visual Windows: **PASS** — 3/3, browser clock frozen tại `2026-08-22T12:00:00Z`; ảnh lặp lại có hash giống nhau.
- Wave 0 visual Linux: **PASS** — 3/3; baseline Linux được review trực tiếp trước khi giữ lại.
- Wave 6 analytics E2E: **PASS** — Axe không còn serious/critical violation.
- Wave 6 visual E2E: **PASS** — 2/2.
- `pnpm test:contract -- tests/contract/sprint19-navigation-registry.test.ts`: **PASS** — toàn bộ contract suite được runner thực thi, 63 tests passed.
- `git diff --check`: **PASS** — chỉ còn cảnh báo chuyển newline của môi trường Windows.
- Full CI sau push: **đang chờ chạy sau khi hoàn thiện polish**.

## An toàn dữ liệu và visual QA

- Không thêm API/DB/worker business logic.
- Không hardcode customer, KPI, số tiền, route detail, actor hoặc branch vào page data.
- Không hiển thị raw JSON trong các bảng generic đã chạm tới.
- Không dùng page-local aggregation cho các domain dashboard đã có read model.
- Worker defect `gift_card_delivery_requests.safe_error_json` đã có cast JSONB đúng kiểu và regression coverage trong commit nền `abcb6c5`; local unit suite không reset DB, integration sẽ được xác nhận trong CI.
- Kiểm tra security exception `SEC-2026-IMAGE-SIZE-METRO` và hạn dùng `2026-09-07` trước khi push; nếu exception hết hạn hoặc không còn hợp lệ thì dừng để xin review mới.

## Trạng thái bàn giao

Final source SHA, Full CI run ID/conclusion, screenshots và trạng thái Docker sẽ được điền sau khi lint/build/browser QA/CI hoàn tất. Không deploy production trong task này.
