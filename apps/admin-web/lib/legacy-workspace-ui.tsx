/* Shared presentation helpers for source-backed operational workspaces. */

import type { ReactNode } from "react";

const LABELS: Record<string, string> = {
  "Platform billing": "Thanh toán nền tảng",
  Subscription: "Gói đăng ký",
  Plans: "Gói dịch vụ",
  "Usage & quotas": "Mức sử dụng & hạn mức",
  "Invoice detail": "Chi tiết hóa đơn",
  "Tenant overview": "Tổng quan tenant",
  Plan: "Gói dịch vụ",
  Renewal: "Gia hạn",
  Entitlements: "Quyền sử dụng",
  "Access mode": "Chế độ truy cập",
  "Payment status": "Trạng thái thanh toán",
  "Billing status": "Trạng thái thanh toán",
  "Platform invoices": "Hóa đơn nền tảng",
  "Payment methods": "Phương thức thanh toán",
  "Billing history": "Lịch sử thanh toán",
  "Support access": "Quyền truy cập hỗ trợ",
  "Plan catalog": "Danh mục gói",
  "Price catalog": "Danh mục giá",
  Discounts: "Mã giảm giá",
  "Tenant lifecycle": "Vòng đời tenant",
  "Invoice operations": "Vận hành hóa đơn",
  "Payment operations": "Vận hành thanh toán",
  "Refund operations": "Vận hành hoàn tiền",
  "Refund ledger": "Sổ hoàn tiền",
  "Request a refund": "Tạo yêu cầu hoàn tiền",
  "Credit notes": "Credit Note",
  "Commission rule": "Quy tắc hoa hồng",
  "Commission rules": "Quy tắc hoa hồng",
  "Commission entries": "Bút toán hoa hồng",
  "Commission periods": "Kỳ hoa hồng",
  "Commission adjustments": "Điều chỉnh hoa hồng",
  "Immutable credit note": "Credit Note bất biến",
  Reconciliation: "Đối soát",
  Dunning: "Nhắc thanh toán",
  "Support grants": "Cấp quyền hỗ trợ",
  refunds: "Hoàn tiền",
  "net sales": "Doanh thu thuần",
  commission: "Hoa hồng",
  "branch id": "Chi nhánh",
  "completed count": "Số bản ghi hoàn tất",
  "refunded minor": "Đã hoàn tiền",
  "service refund minor": "Hoàn dịch vụ",
  "tax refund minor": "Thuế hoàn",
  "tip refund minor": "Tip hoàn",
  "Break glass": "Quyền khẩn cấp",
  "Platform reports": "Báo cáo nền tảng",
  "Accounting control center": "Trung tâm kiểm soát kế toán",
  "Benefits workspace": "Trung tâm quyền lợi khách hàng",
  "Service categories": "Nhóm dịch vụ",
  "Service catalog": "Danh mục dịch vụ",
  Skills: "Kỹ năng",
  "Resource types": "Loại tài nguyên",
  "Branch resources": "Tài nguyên chi nhánh",
  "Staff profiles": "Hồ sơ nhân sự",
  "Create staff profile": "Tạo hồ sơ nhân sự",
  "Shift planner": "Lập lịch ca",
  "Leave review": "Duyệt đơn nghỉ",
  "Voucher campaigns": "Chiến dịch Voucher",
  "Voucher campaign": "Chiến dịch Voucher",
  "Voucher codes": "Mã Voucher",
  "Loyalty programs": "Chương trình Loyalty",
  "Membership tiers": "Hạng Membership",
  "Service package catalog": "Danh mục gói dịch vụ",
  "Customer loyalty ledger": "Lịch sử Loyalty của khách",
  "Customer credit": "Store Credit",
  "Customer credit accounts": "Tài khoản Store Credit",
  eligibility: "điều kiện áp dụng",
  order: "đơn POS",
  "Benefit reports": "Báo cáo quyền lợi",
  "Benefit liability": "Nghĩa vụ quyền lợi",
  Wallet: "Ví quyền lợi",
  Vouchers: "Voucher",
  Reports: "Báo cáo",
  Liability: "Nghĩa vụ",
  "Voucher effectiveness": "Hiệu quả Voucher",
  "Loyalty liability": "Nghĩa vụ Loyalty",
  "Membership counts": "Số lượng Membership",
  "Package liability": "Nghĩa vụ gói dịch vụ",
  "Expiring benefits": "Quyền lợi sắp hết hạn",
  "Accounting books": "Sổ kế toán",
  "Accounting periods": "Kỳ kế toán",
  "Journal workbench": "Sổ nhật ký",
  "Posting queue": "Hàng đợi ghi sổ",
  "Financial reports": "Báo cáo tài chính",
  "Open items": "Khoản mục chưa tất toán",
  "Bank reconciliation": "Đối soát ngân hàng",
  "Vendor-to-AP workflow with immutable snapshots and approval evidence.": "Quy trình từ nhà cung cấp đến phải trả với snapshot bất biến và bằng chứng phê duyệt.",
  "Masked payment references and ON_HOLD vendors are blocked from new spend.": "Tham chiếu thanh toán được che và nhà cung cấp đang tạm giữ không được phát sinh chi mới.",
  "Submit and independently approve requested quantities.": "Gửi yêu cầu và phê duyệt độc lập số lượng cần mua.",
  "Server-numbered, versioned and immutable after approval.": "Đánh số từ máy chủ, có phiên bản và bất biến sau phê duyệt.",
  "Partial receipt and tolerance caps are enforced in PostgreSQL.": "Nhận một phần và giới hạn dung sai được PostgreSQL kiểm soát.",
  "Duplicate invoice guard and 3-way match before posting.": "Chặn hóa đơn trùng và đối chiếu ba bên trước khi ghi sổ.",
  "Aging, holds and outstanding balances are derived from allocations.": "Tuổi nợ, trạng thái giữ và số dư chưa thanh toán được suy ra từ phân bổ.",
  "Reserve open-item amounts before dual-control approval.": "Giữ số tiền khoản mục trước khi phê duyệt kép.",
  "Provider processing is worker-owned and unknown outcomes require reconciliation.": "Worker quản lý xử lý nhà cung cấp; kết quả chưa xác định phải được đối soát.",
  "Exact bill-line eligibility and cumulative caps protect AP.": "Điều kiện theo dòng hóa đơn và giới hạn lũy kế bảo vệ công nợ phải trả.",
  "Returned quantity cannot exceed accepted receipt quantity.": "Số lượng trả không được vượt số lượng đã nhận đạt yêu cầu.",
  "Plan, access status and renewal at a glance": "Tổng quan gói, quyền truy cập và gia hạn.",
  "Versioned lifecycle; downgrade preserves salon data": "Vòng đời có phiên bản; hạ gói vẫn bảo toàn dữ liệu salon.",
  "Published plans and test prices": "Các gói đã công bố và mức giá được cấu hình.",
  "Authoritative metered usage and quota evidence": "Bằng chứng mức sử dụng và hạn mức từ máy chủ.",
  "Separate from salon POS invoices": "Tách biệt với hóa đơn POS của salon.",
  "Token references only; no raw card data": "Chỉ dùng tham chiếu token; không hiển thị dữ liệu thẻ thô.",
  "Immutable invoice and collection trail": "Dấu vết hóa đơn và thu tiền bất biến.",
  "Tenant-visible, scoped and time-limited support grants": "Quyền hỗ trợ hiển thị cho tenant, có phạm vi và thời hạn.",
  "Draft, publish, supersede and retire immutable versions": "Tạo nháp, công bố, thay thế và ngừng phiên bản bất biến.",
  "Integer minor-unit prices and explicit intervals": "Giá theo đơn vị minor nguyên và chu kỳ rõ ràng.",
  "Evidence-backed discount foundation": "Nền tảng giảm giá dựa trên bằng chứng.",
  "Billing state without salon operational data": "Trạng thái thanh toán không mở dữ liệu vận hành salon.",
  "Finalized invoices and lines are immutable": "Hóa đơn và dòng đã chốt là bất biến.",
  "Stable provider key and UNKNOWN-first reconciliation": "Khóa nhà cung cấp ổn định và đối soát ưu tiên kết quả chưa xác định.",
  "Refund cap and independent approval evidence": "Giới hạn hoàn tiền và bằng chứng phê duyệt độc lập.",
  "Resolve UNKNOWN before another provider attempt": "Xử lý kết quả chưa xác định trước khi thử lại nhà cung cấp.",
  "Transactional email stages and access-mode transition": "Các giai đoạn email giao dịch và chuyển chế độ truy cập.",
  "No salon data access without active scoped grant": "Không truy cập dữ liệu salon nếu chưa có cấp quyền đang hiệu lực.",
  "Disabled by default; dual approval required": "Mặc định tắt; yêu cầu phê duyệt kép.",
  "SaaS-only data; excludes salon POS and payroll": "Chỉ dữ liệu SaaS; không bao gồm POS và bảng lương salon.",
  "Post only balanced, tenant-scoped journals in an open period.": "Chỉ ghi sổ cân đối, đúng tenant và trong kỳ đang mở.",
  "Book activation is blocked until periods, accounts and checklist readiness are complete.": "Không thể kích hoạt sổ trước khi kỳ, tài khoản và checklist đã sẵn sàng.",
  "Close and reopen use separate, evidence-backed commands.": "Đóng và mở lại kỳ dùng các lệnh riêng có bằng chứng.",
  "Submit, approve, post and reverse through explicit commands.": "Gửi, phê duyệt, ghi sổ và đảo bút toán bằng lệnh rõ ràng.",
  "Source events are mapped and leased by the worker before posting.": "Sự kiện nguồn được ánh xạ và worker nhận lease trước khi ghi sổ.",
  "Reports read posted journals only; choose a book before querying.": "Báo cáo chỉ đọc bút toán đã ghi sổ; chọn sổ trước khi tra cứu.",
  "Settlement requires a posted journal in the same book and currency.": "Tất toán yêu cầu bút toán đã ghi sổ trong cùng sổ và tiền tệ.",
  "Statement imports and reconciliation remain append-only evidence.": "Nhập sao kê và đối soát là bằng chứng append-only.",
  "Platform boundary view; salon appointments and payroll remain opaque": "Màn hình ranh giới nền tảng; lịch hẹn và bảng lương salon vẫn tách biệt.",
  "Immutable finalized platform invoice": "Hóa đơn nền tảng đã chốt, bất biến.",
  "Fixed asset register": "Sổ tài sản cố định",
  "Asset candidates": "Tài sản chờ ghi nhận",
  "Capitalization approvals": "Phê duyệt vốn hóa",
  "Depreciation runs": "Kỳ khấu hao",
  "Maintenance work orders": "Lệnh bảo trì",
  "Asset transfers": "Điều chuyển tài sản",
  "Asset counts": "Kiểm kê tài sản",
  Inspections: "Kiểm tra tài sản",
  Impairments: "Suy giảm giá trị",
  Disposals: "Thanh lý tài sản",
  "Asset reports": "Báo cáo tài sản",
  id: "Mã bản ghi",
  tenantId: "Tenant",
  branchId: "Chi nhánh",
  customerId: "Khách hàng",
  userId: "Người dùng",
  staffId: "Nhân sự",
  accountId: "Tài khoản",
  status: "Trạng thái",
  version: "Phiên bản",
  createdAt: "Ngày tạo",
  updatedAt: "Cập nhật",
  occurredAt: "Thời điểm",
  scheduledAt: "Lịch thực hiện",
  effectiveAt: "Thời điểm hiệu lực",
  dueAt: "Hạn xử lý",
  currency: "Tiền tệ",
  availablePoints: "Điểm khả dụng",
  pendingPoints: "Điểm đang chờ",
  lifetimeEarnedPoints: "Tổng điểm đã tích",
  redeemedPoints: "Điểm đã đổi",
  availableUnits: "Lượt còn lại",
  remainingUnits: "Lượt còn lại",
  packageRemainingUnits: "Lượt gói còn lại",
  loyaltyAvailablePoints: "Điểm Loyalty khả dụng",
  loyaltyLiabilityMinor: "Nghĩa vụ Loyalty",
  reservedPoints: "Điểm đang giữ",
  packageLiabilityMinor: "Nghĩa vụ gói dịch vụ",
  accounts: "Số tài khoản",
  voucherDiscounts: "Giảm giá Voucher",
  note: "Ghi chú",
  "Voucher discounts are not cash liability": "Giảm giá Voucher không phải là nghĩa vụ tiền mặt",
  amountMinor: "Số tiền",
  totalMinor: "Tổng tiền",
  description: "Mô tả",
  name: "Tên",
  displayName: "Tên hiển thị",
  code: "Mã",
  reference: "Tham chiếu",
  type: "Loại",
  category: "Nhóm",
  interval: "Chu kỳ",
  planId: "Gói dịch vụ",
  invoiceId: "Hóa đơn",
  paymentIntentId: "Lệnh thanh toán",
  provider: "Nhà cung cấp",
  reason: "Lý do",
  "Legal name": "Tên pháp lý",
  "Payment terms (days)": "Điều khoản thanh toán (ngày)",
  "Unit price (minor)": "Đơn giá (minor)",
  "New purchase request": "Tạo yêu cầu mua hàng",
  "Add vendor": "Thêm nhà cung cấp",
  approvedBy: "Người phê duyệt",
  requestedBy: "Người yêu cầu",
  createdBy: "Người tạo",
  ACTIVE: "Đang hoạt động",
  APPROVED: "Đã phê duyệt",
  CANCELLED: "Đã hủy",
  COMPLETED: "Đã hoàn tất",
  DRAFT: "Bản nháp",
  FAILED: "Thất bại",
  INACTIVE: "Không hoạt động",
  OPEN: "Đang mở",
  PAID: "Đã thanh toán",
  PARTIALLY_PAID: "Thanh toán một phần",
  PENDING: "Đang chờ",
  PENDING_APPROVAL: "Chờ phê duyệt",
  POSTED: "Đã ghi sổ",
  PROCESSING: "Đang xử lý",
  REJECTED: "Đã từ chối",
  SCHEDULED: "Đã lên lịch",
  SUBMITTED: "Đã gửi duyệt",
  SUCCEEDED: "Thành công",
  UNKNOWN: "Chưa xác định",
  VOID: "Đã vô hiệu hóa",
  REVOKED: "Đã thu hồi",
  calculate: "Tính toán",
  recalculate: "Tính lại",
  finalize: "Chốt kỳ",
  approve: "Phê duyệt",
  reject: "Từ chối",
  cancel: "Hủy",
  revoke: "Thu hồi",
  activate: "Kích hoạt",
  confirm: "Xác nhận",
  reconcile: "Đối soát",
  pay: "Thanh toán",
  process: "Xử lý",
  "start-session": "Bắt đầu phiên",
  "change-plan": "Đổi gói",
  reactivate: "Kích hoạt lại",
  "request-reversal": "Yêu cầu đảo bút toán",
  start: "Bắt đầu",
  deny: "Từ chối",
  void: "Vô hiệu hóa",
  publish: "Công bố",
};

export function legacyText(value: string): string {
  if (LABELS[value]) return LABELS[value];
  const tenant = value.match(/^Tenant (overview|usage|subscription|entitlements|invoices|payments|lifecycle)$/i);
  if (tenant) return `Tenant · ${legacyText(tenant[1] ?? "overview")}`;
  return value;
}

export function legacyColumnLabel(value: string) {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  const normalized = spaced.toLowerCase();
  return LABELS[value] ?? LABELS[spaced] ?? LABELS[normalized] ?? spaced;
}

export function legacyActionLabel(value: string) {
  return LABELS[value] ?? value.replaceAll("-", " ");
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  return `${(local ?? "").slice(0, 2)}•••@${domain ?? ""}`;
}

export function legacyValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const normalizedKey = key?.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  if (key === "id" || key?.endsWith("Id") || key?.endsWith("ID") || normalizedKey?.endsWith(" id") || normalizedKey?.endsWith(" uuid")) return "Mã hệ thống";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.length ? `${value.length} mục` : "Không có";
    const record = value as Record<string, unknown>;
    const candidate = record.displayName ?? record.name ?? record.code ?? record.reference;
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      return String(nested["vi-VN"] ?? nested["en-US"] ?? nested.name ?? nested.code ?? "Thông tin liên quan");
    }
    return String(candidate ?? "Thông tin liên quan");
  }
  const text = String(value);
  if (text.includes("@")) return maskEmail(text);
  if (LABELS[text]) return LABELS[text];
  return text;
}

const SENSITIVE_KEYS = /(^|_)(secret|token|password|hash|contactHash|providerPayload|renderedHtml|renderedText|variablesJson|proposalJson|filterJson)($|_)/i;

function isDisplayableKey(key: string) {
  return !SENSITIVE_KEYS.test(key) && !["createdByUserId", "updatedByUserId"].includes(key);
}

export function LegacyDataTable({
  rows,
  columns,
  excludeKeys = [],
  empty = "Chưa có dữ liệu phù hợp.",
}: {
  rows: unknown[];
  columns?: string[];
  excludeKeys?: string[];
  empty?: ReactNode;
}) {
  const records = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  const keys = columns?.filter(isDisplayableKey) ?? Array.from(new Set(records.flatMap((row) => Object.keys(row)))).filter(isDisplayableKey).slice(0, 8);
  const visibleKeys = keys.filter((key) => !excludeKeys.includes(key));
  if (!records.length || !visibleKeys.length) return <div className="legacy-empty">{empty}</div>;
  return (
    <div className="legacy-table-wrap">
      <table className="legacy-data-table">
        <thead>
          <tr>{visibleKeys.map((key) => <th scope="col" key={key}>{legacyColumnLabel(key)}</th>)}</tr>
        </thead>
        <tbody>
          {records.map((row, index) => (
            <tr key={String(row.id ?? row.reference ?? index)}>
              {visibleKeys.map((key) => <td key={key} data-label={legacyColumnLabel(key)}>{legacyValue(row[key], key)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
