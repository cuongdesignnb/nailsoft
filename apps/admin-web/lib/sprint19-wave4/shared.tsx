/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "../auth";

export type Row = Record<string, any>;
export type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";

const WAVE4_TEXT: Record<string, string> = {
  "Workforce operations": "Vận hành nhân sự",
  "People": "Nhân sự",
  "Pay setup": "Thiết lập lương",
  "Currency": "Tiền tệ",
  "Save pay profile": "Lưu hồ sơ lương",
  "Payroll": "Bảng lương",
  "Payout": "Chi trả",
  "Attendance": "Chấm công",
  "Scheduling": "Lịch làm việc",
  "Staff directory": "Danh sách nhân sự",
  "Create staff profile": "Tạo hồ sơ nhân sự",
  "Staff profile": "Hồ sơ nhân sự",
  "Staff pay profile": "Hồ sơ lương nhân sự",
  "Workforce policies": "Chính sách nhân sự",
  "Workforce compliance": "Tuân thủ nhân sự",
  "Workforce reports": "Báo cáo nhân sự",
  "Versioned configurable rules with legal-review gates.": "Quy tắc cấu hình theo phiên bản, có kiểm soát rà soát pháp lý.",
  "Exceptions and evidence without hardcoded jurisdiction rules.": "Ngoại lệ và bằng chứng theo dữ liệu thật, không áp đặt quy tắc địa phương trong giao diện.",
  "Attendance, overtime, break and exception evidence.": "Bằng chứng chấm công, làm thêm, thời gian nghỉ và ngoại lệ.",
  "Operational profile, branch assignments and service skills.": "Hồ sơ vận hành, phân công chi nhánh và kỹ năng dịch vụ.",
  "Tra cứu hồ sơ vận hành, hình thức làm việc và phân công chi nhánh.": "Tra cứu hồ sơ vận hành, hình thức làm việc và phân công chi nhánh.",
  "Assignments and skills are scoped to the current tenant and branch.": "Phân công và kỹ năng được giới hạn theo salon và chi nhánh hiện tại.",
  "Add an operational profile without exposing payroll or private identity data.": "Thêm hồ sơ vận hành mà không mở lộ dữ liệu lương hoặc danh tính riêng tư.",
  "Payroll runs": "Kỳ chạy bảng lương",
  "Payroll calendars": "Lịch bảng lương",
  "Payroll periods": "Kỳ bảng lương",
  "Payroll exceptions": "Ngoại lệ bảng lương",
  "Pay statements": "Phiếu lương",
  "Payroll reports": "Báo cáo bảng lương",
  "Payout batches": "Đợt chi trả",
  "Payout reconciliation": "Đối soát chi trả",
  "Payroll run detail": "Chi tiết kỳ chạy bảng lương",
  "Payouts": "Các khoản chi trả",
  "Live time clock": "Chấm công thời gian thực",
  "Attendance sessions": "Phiên chấm công",
  "Attendance exceptions": "Ngoại lệ chấm công",
  "Trusted clock devices": "Thiết bị chấm công tin cậy",
  "Staff timesheets": "Bảng công nhân sự",
  "Timesheet detail": "Chi tiết bảng công",
  "Timesheet evidence": "Bằng chứng bảng công",
  "Timesheet source": "Nguồn bảng công",
  "Submitted at": "Thời điểm gửi duyệt",
  "Approved at": "Thời điểm phê duyệt",
  "Locked at": "Thời điểm khóa",
  "Regular hours": "Giờ làm thường",
  "Overtime hours": "Giờ làm thêm",
  "Payable hours": "Giờ được thanh toán",
  "Scheduled hours": "Giờ theo lịch",
  "Paid break": "Nghỉ có trả lương",
  "Unpaid break": "Nghỉ không trả lương",
  "Exceptions": "Ngoại lệ",
  "Adjustments": "Điều chỉnh",
  "No adjustment requests.": "Chưa có yêu cầu điều chỉnh.",
  "Timesheet periods": "Kỳ bảng công",
  "Shift planner": "Lập lịch ca",
  "Leave review": "Duyệt đơn nghỉ",
  "Loading workspace": "Đang tải không gian làm việc",
  "Permission denied": "Không có quyền truy cập",
  "Unable to load": "Không thể tải dữ liệu",
  "Nothing here yet": "Chưa có dữ liệu",
  "Refresh": "Làm mới",
  "Retry": "Thử lại",
  "Back to directory": "Quay lại danh sách",
  "Add staff": "Thêm nhân sự",
  "Create profile": "Tạo hồ sơ",
  "Creating…": "Đang tạo…",
  "Cancel": "Hủy",
  "Close form": "Đóng biểu mẫu",
  "Create shift": "Tạo ca làm",
  "Saving…": "Đang lưu…",
  "Save shift": "Lưu ca làm",
  "Resolve": "Xử lý",
  "Approve": "Phê duyệt",
  "Calculate": "Tính toán",
  "Submit": "Gửi duyệt",
  "Finalize": "Chốt kỳ",
  "Process": "Xử lý",
  "Acknowledge": "Xác nhận",
  "Waive": "Miễn trừ",
  "Reopen": "Mở lại",
  "Revoke": "Thu hồi",
  "Reject": "Từ chối",
  "Suspend": "Tạm ngưng",
  "Activate": "Kích hoạt",
  "Profile": "Hồ sơ",
  "Branch assignments": "Phân công chi nhánh",
  "Skills": "Kỹ năng",
  "Name": "Họ tên",
  "Employee code": "Mã nhân sự",
  "Employment": "Hình thức làm việc",
  "Employment type": "Hình thức làm việc",
  "Status": "Trạng thái",
  "Locale": "Ngôn ngữ",
  "Version": "Phiên bản",
  "Branch": "Chi nhánh",
  "Primary": "Chính",
  "Bookable": "Có thể đặt lịch",
  "Skill": "Kỹ năng",
  "Level": "Cấp độ",
  "Starts": "Bắt đầu",
  "Ends": "Kết thúc",
  "Staff": "Nhân sự",
  "Type": "Loại",
  "From": "Từ ngày",
  "To": "Đến ngày",
  "Break minutes": "Phút nghỉ",
  "Branch ID": "Chi nhánh",
  "Staff ID": "Nhân sự",
  "Start": "Bắt đầu",
  "End": "Kết thúc",
  "Profile type": "Loại hồ sơ",
  "Effective from": "Có hiệu lực từ",
  "Effective to": "Có hiệu lực đến",
  "Membership ID": "Mã Membership",
  "Level code": "Mã cấp bậc",
  "Hire date": "Ngày bắt đầu làm",
  "Legal name": "Tên pháp lý",
  "Preferred name": "Tên gọi ưu tiên",
  "Display name": "Tên hiển thị",
  "Notes": "Ghi chú",
  "Preferred locale": "Ngôn ngữ ưu tiên",
  "No records are available in this scope.": "Chưa có bản ghi trong phạm vi được cấp quyền.",
  "No staff profiles match this workspace.": "Chưa có hồ sơ nhân sự phù hợp.",
  "No branch assignments.": "Chưa có phân công chi nhánh.",
  "No skills assigned.": "Chưa có kỹ năng được gán.",
  "No attendance records match the current scope.": "Chưa có bản ghi chấm công phù hợp.",
  "No shifts are scheduled for the current branch.": "Chưa có ca làm ở chi nhánh hiện tại.",
  "No leave requests are waiting for review.": "Không có đơn nghỉ đang chờ duyệt.",
  "Pay profile has not been initialized.": "Hồ sơ lương chưa được khởi tạo.",
  "Search staff": "Tìm nhân sự",
  "Name or employee code": "Tên hoặc mã nhân sự",
  "Live server data": "Dữ liệu máy chủ trực tiếp",
  "Server authoritative": "Dữ liệu máy chủ",
  "Deterministic sources, independent approval and immutable finalization.": "Nguồn dữ liệu xác định, phê duyệt độc lập và chốt kỳ bất biến.",
  "Server-time attendance view for the current branch.": "Chấm công theo thời gian máy chủ tại chi nhánh hiện tại.",
  "Periods generated from locked timesheet windows.": "Kỳ được tạo từ các khoảng bảng công đã khóa.",
  "Blocking source, policy, currency and payout readiness issues.": "Các vấn đề chặn nguồn dữ liệu, chính sách, tiền tệ và điều kiện chi trả.",
  "Private immutable finalized statements.": "Phiếu lương riêng tư, bất biến sau khi chốt.",
  "Earnings, commission, tips and source reconciliation.": "Thu nhập, hoa hồng, tiền tip và đối soát nguồn.",
  "Evidence-led payout processing with dual control.": "Xử lý chi trả theo bằng chứng và kiểm soát kép.",
  "Expected, confirmed, reversed and variance evidence.": "Bằng chứng dự kiến, xác nhận, đảo và chênh lệch.",
  "Scheduled versus actual time and break evidence.": "Bằng chứng thời gian theo lịch, thời gian thực tế và thời gian nghỉ.",
  "Resolve missed punches and compliance exceptions with audit evidence.": "Xử lý thiếu lượt chấm và ngoại lệ tuân thủ bằng bằng chứng audit.",
  "Branch-bound kiosk and device trust.": "Thiết bị và kiosk tin cậy theo chi nhánh.",
  "Review, correct and lock source timesheets.": "Rà soát, điều chỉnh và khóa bảng công nguồn.",
  "Submission and review windows with immutable lock states.": "Khoảng gửi và rà soát với trạng thái khóa bất biến.",
  PUBLISHED: "Đã công bố",
  DRAFT: "Bản nháp",
  CANCELLED: "Đã hủy",
  APPROVED: "Đã phê duyệt",
  SUBMITTED: "Đã gửi duyệt",
  LOCKED: "Đã khóa",
  REOPENED: "Đã mở lại",
  REJECTED: "Đã từ chối",
  PENDING: "Đang chờ",
  ACTIVE: "Đang hoạt động",
  INACTIVE: "Không hoạt động",
  FULL_TIME: "Toàn thời gian",
  PART_TIME: "Bán thời gian",
  CONTRACTOR: "Cộng tác viên",
  TEMPORARY: "Tạm thời",
  HOURLY: "Theo giờ",
  SALARY: "Theo lương cố định",
  COMMISSION_ONLY: "Chỉ hoa hồng",
  HOURLY_PLUS_COMMISSION: "Theo giờ + hoa hồng",
  SALARY_PLUS_COMMISSION: "Lương cố định + hoa hồng",
  OPEN: "Đang mở",
  COMPLETED: "Đã hoàn tất",
  FAILED: "Thất bại",
  ANNUAL: "Nghỉ phép năm",
  SICK: "Nghỉ ốm",
  UNPAID: "Nghỉ không lương",
  MONTH: "Hàng tháng",
  YEAR: "Hàng năm",
  "Saved successfully": "Đã lưu sau khi máy chủ xác nhận.",
  "Staff profile created": "Hồ sơ nhân sự đã được tạo sau khi máy chủ xác nhận.",
  "Unable to create staff": "Không thể tạo hồ sơ nhân sự.",
  "Unable to save pay profile": "Không thể lưu hồ sơ lương.",
  "Request failed": "Yêu cầu không thành công.",
  "Request failed. Retry safely.": "Yêu cầu không thành công. Bạn có thể thử lại an toàn.",
  "Internet connection required for workforce and payroll changes.": "Cần kết nối Internet để thay đổi dữ liệu nhân sự và bảng lương.",
  "No records found.": "Chưa có bản ghi.",
  "The action failed. No success is shown until the server confirms it.": "Thao tác thất bại; chỉ hiển thị thành công sau khi máy chủ xác nhận.",
};

export function wave4Text(value: string) {
  const exact = WAVE4_TEXT[value] ?? WAVE4_TEXT[value.charAt(0).toUpperCase() + value.slice(1)];
  if (exact) return exact;
  const action = value.match(/^(calculate|submit|approve|finalize|cancel|revoke|acknowledge|resolve|waive|lock|reopen|reject)\s+(.+)$/i);
  if (action) {
    const actionName = action[1] ?? "";
    const target = action[2] ?? "";
    const verb = WAVE4_TEXT[actionName.charAt(0).toUpperCase() + actionName.slice(1).toLowerCase()] ?? actionName;
    return `${verb} ${target}`;
  }
  return value;
}

export function wave4ColumnLabel(key: string, label: string) {
  const keyMap: Record<string, string> = {
    id: "Mã bản ghi", tenantId: "Tenant", branchId: "Chi nhánh", staffId: "Nhân sự", shiftId: "Ca làm",
    clockInEventId: "Sự kiện vào ca", clockOutEventId: "Sự kiện ra ca", displayName: "Họ tên", employeeCode: "Mã nhân sự",
    employmentType: "Hình thức làm việc", preferredLocale: "Ngôn ngữ", status: "Trạng thái", version: "Phiên bản",
    startAt: "Bắt đầu", endAt: "Kết thúc", leaveType: "Loại nghỉ", breakMinutes: "Phút nghỉ",
  };
  return WAVE4_TEXT[label] ?? keyMap[key] ?? WAVE4_TEXT[key] ?? label.replaceAll("_", " ");
}

export async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(wave4Text(body?.error?.message ?? "Permission denied")), { forbidden: true });
  }
  if (!response.ok) throw new Error(wave4Text(body?.error?.message ?? body?.message ?? "Request failed. Retry safely."));
  return body?.data;
}

export async function command(path: string, body?: Row, method = "POST", idempotencyKey = crypto.randomUUID()) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error(wave4Text("Internet connection required for workforce and payroll changes."));
  const init: RequestInit = { method, headers: { "content-type": "application/json", "idempotency-key": idempotencyKey } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return api(path, init);
}

export function useResource(path: string) {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = await api(path); const list = Array.isArray(value) ? value : value?.items ?? (value ? [value] : []); setRows(list); setState(list.length ? "ready" : "empty"); }
    catch (cause: any) { setError(wave4Text(cause?.message ?? "Request failed")); setState(cause?.forbidden ? "forbidden" : "error"); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { state, rows, error, reload: load };
}

export function StatePanel({ state, error, retry, empty = "No records found." }: { state: LoadState; error?: string; retry: () => void; empty?: string }) {
  if (state === "loading") return <div className="s19-state" role="status"><div><h2>{wave4Text("Loading workspace")}</h2><p>Đang tải dữ liệu trực tiếp từ máy chủ…</p></div></div>;
  if (state === "forbidden") return <div className="s19-state" role="alert"><div><h2>{wave4Text("Permission denied")}</h2><p>Vai trò hoặc phạm vi chi nhánh hiện tại không bao gồm màn hình này.</p></div></div>;
  if (state === "error") return <div className="s19-state" role="alert"><div><h2>{wave4Text("Unable to load")}</h2><p>{error || "Máy chủ trả về lỗi."}</p><button className="s19-button s19-button-secondary" onClick={retry}>{wave4Text("Retry")}</button></div></div>;
  if (state === "empty") return <div className="s19-state"><div><h2>{wave4Text("Nothing here yet")}</h2><p>{wave4Text(empty)}</p></div></div>;
  return null;
}

export function Page({ eyebrow = "Workforce operations", title, description, children, actions }: { eyebrow?: string; title: string; description: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <main className="s19-w4-page"><header className="s19-page-heading"><div><p className="s19-eyebrow">{wave4Text(eyebrow)}</p><h1>{wave4Text(title)}</h1><p>{wave4Text(description)}</p></div>{actions && <div className="s19-page-heading-actions">{actions}</div>}</header>{children}</main>;
}

export function Table({ rows, columns, onSelect }: { rows: Row[]; columns: Array<[string, string]>; onSelect?: (row: Row) => void }) {
  return <div className="s19-w4-table-wrap"><table className="s19-w4-table"><thead><tr>{columns.map(([key, label]) => <th key={key} scope="col">{wave4ColumnLabel(key, label)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index} onClick={() => onSelect?.(row)}>{columns.map(([key, label]) => <td key={key} data-label={wave4ColumnLabel(key, label)}>{format(row[key], key)}</td>)}</tr>)}</tbody></table></div>;
}

export function format(value: any, key = "") {
  if (value === null || value === undefined || value === "") return "—";
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  if ((key === "id" || key.endsWith("Id") || key.endsWith("ID") || normalizedKey.endsWith(" id") || normalizedKey.endsWith(" uuid")) && typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "Mã hệ thống";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (normalizedKey.includes("status") || normalizedKey === "state") return wave4Text(String(value).toUpperCase());
  if (/(at|date|start|end|from|to|due)$/.test(normalizedKey) && !Number.isNaN(Date.parse(String(value)))) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  if (typeof value === "object") return value.name?.["vi-VN"] ?? value.name?.["en-US"] ?? value.displayName ?? value.code ?? "Có dữ liệu";
  const mapped = wave4Text(String(value).toUpperCase());
  if (mapped !== String(value).toUpperCase()) return mapped;
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  return String(value);
}

export function Field({ label, name, type = "text", value, onChange, required }: { label: string; name: string; type?: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="s19-field"><span>{wave4Text(label)}{required ? " *" : ""}</span><input name={name} type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function ActionButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) { return <button className={`s19-button ${danger ? "s19-button-danger" : "s19-button-secondary"}`} onClick={onClick}>{wave4Text(label)}</button>; }

export function useMutation(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const intentKeys = useRef<Record<string, string>>({});
  const run = async (path: string, body?: Row, method = "POST") => {
    const intent = `${method}:${path}:${String(body?.version ?? "")}`;
    const key = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    setBusy(true); setNotice(""); setError("");
    try {
      await command(path, body, method, key);
      delete intentKeys.current[intent];
      setNotice(wave4Text("Saved successfully"));
      await reload();
    } catch (cause: any) {
      setError(wave4Text(cause?.message ?? "The action failed. No success is shown until the server confirms it."));
    } finally { setBusy(false); }
  };
  return { busy, notice, error, run };
}
