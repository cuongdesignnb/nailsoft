/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "./auth";
type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type Config = {
  title: string;
  endpoint: string;
  create?: string;
  actions?: string[];
  hint: string;
};
const configs: Record<string, Config> = {
  "/admin/time-clock": {
    title: "Live time clock",
    endpoint: "/v1/time-clock/sessions",
    hint: "Server-time attendance and active sessions",
  },
  "/admin/time-clock/sessions": {
    title: "Attendance sessions",
    endpoint: "/v1/time-clock/sessions",
    hint: "Scheduled versus actual, breaks and review state",
  },
  "/admin/time-clock/exceptions": {
    title: "Attendance exceptions",
    endpoint: "/v1/time-clock/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "Evidence-led missed punch and compliance review",
  },
  "/admin/time-clock/devices": {
    title: "Trusted clock devices",
    endpoint: "/v1/time-clock/devices",
    create: "/v1/time-clock/devices",
    actions: ["revoke"],
    hint: "Branch-bound kiosk and device trust",
  },
  "/admin/timesheets": {
    title: "Staff timesheets",
    endpoint: "/v1/timesheets",
    actions: ["submit", "approve", "reject", "reopen", "lock"],
    hint: "Review, correction, dual approval and source lock",
  },
  "/admin/timesheet-periods": {
    title: "Timesheet periods",
    endpoint: "/v1/timesheet-periods",
    create: "/v1/timesheet-periods",
    hint: "Submission and review windows",
  },
  "/admin/workforce/policies": {
    title: "Workforce policies",
    endpoint: "/v1/workforce-compliance/policies",
    create: "/v1/workforce-compliance/policies",
    hint: "Versioned configurable rules with legal-review gate",
  },
  "/admin/workforce/compliance": {
    title: "Workforce compliance",
    endpoint: "/v1/time-clock/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "No jurisdiction rule is hardcoded",
  },
  "/admin/workforce/reports": {
    title: "Workforce reports",
    endpoint: "/v1/workforce/reports/attendance",
    hint: "Attendance, overtime, break and exception evidence",
  },
  "/admin/payroll/calendars": {
    title: "Payroll calendars",
    endpoint: "/v1/payroll-calendars",
    create: "/v1/payroll-calendars",
    hint: "Timezone-aware configurable payroll frequency",
  },
  "/admin/payroll/periods": {
    title: "Payroll periods",
    endpoint: "/v1/payroll/periods",
    create: "/v1/payroll/periods/generate",
    hint: "Ready periods from locked timesheet windows",
  },
  "/admin/payroll/runs": {
    title: "Payroll runs",
    endpoint: "/v1/payroll/runs",
    create: "/v1/payroll/runs",
    actions: [
      "calculate",
      "recalculate",
      "submit",
      "approve",
      "finalize",
      "request-void",
      "approve-void",
    ],
    hint: "Deterministic sources, independent approval and immutable finalize",
  },
  "/admin/payroll/exceptions": {
    title: "Payroll exceptions",
    endpoint: "/v1/payroll/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "Blocking source, policy, currency and payout readiness issues",
  },
  "/admin/payroll/statements": {
    title: "Pay statements",
    endpoint: "/v1/pay-statements",
    hint: "Private immutable finalized statements",
  },
  "/admin/payroll/reports": {
    title: "Payroll reports",
    endpoint: "/v1/payroll/reports/summary",
    hint: "Earnings, commission, tips and source reconciliation",
  },
  "/admin/payouts": {
    title: "Payout batches",
    endpoint: "/v1/payout-batches",
    create: "/v1/payout-batches",
    actions: ["submit", "approve", "process", "cancel"],
    hint: "No PAID state without external or approved manual evidence",
  },
  "/admin/payout-reconciliation": {
    title: "Payout reconciliation",
    endpoint: "/v1/payout-reconciliations",
    hint: "Expected, confirmed, reversed and variance evidence",
  },
};
const nav = [
  "/admin/time-clock",
  "/admin/timesheets",
  "/admin/workforce/compliance",
  "/admin/payroll/runs",
  "/admin/payroll/statements",
  "/admin/payouts",
];
const workforceLabels: Record<string, string> = {
  "Live time clock": "Chấm công thời gian thực",
  "Attendance sessions": "Phiên chấm công",
  "Attendance exceptions": "Ngoại lệ chấm công",
  "Trusted clock devices": "Thiết bị chấm công tin cậy",
  "Staff timesheets": "Bảng công nhân sự",
  "Timesheet periods": "Kỳ bảng công",
  "Workforce policies": "Chính sách nhân sự",
  "Workforce compliance": "Tuân thủ nhân sự",
  "Workforce reports": "Báo cáo nhân sự",
  "Payroll calendars": "Lịch bảng lương",
  "Payroll periods": "Kỳ bảng lương",
  "Payroll runs": "Kỳ chạy bảng lương",
  "Payroll exceptions": "Ngoại lệ bảng lương",
  "Pay statements": "Phiếu lương",
  "Payroll reports": "Báo cáo bảng lương",
  "Payout batches": "Đợt chi trả",
  "Payout reconciliation": "Đối soát chi trả",
  "Staff pay profile": "Hồ sơ lương nhân sự",
  "Server-time attendance and active sessions": "Chấm công theo thời gian máy chủ và các phiên đang hoạt động.",
  "Scheduled versus actual, breaks and review state": "Đối chiếu lịch, thời gian thực tế, giờ nghỉ và trạng thái rà soát.",
  "Evidence-led missed punch and compliance review": "Rà soát thiếu lượt chấm và tuân thủ theo bằng chứng.",
  "Branch-bound kiosk and device trust": "Thiết bị và kiosk tin cậy theo chi nhánh.",
  "Review, correction, dual approval and source lock": "Rà soát, điều chỉnh, phê duyệt kép và khóa dữ liệu nguồn.",
  "Submission and review windows": "Khoảng thời gian gửi và rà soát bảng công.",
  "Versioned configurable rules with legal-review gate": "Quy tắc có phiên bản, cấu hình được và có bước rà soát pháp lý.",
  "No jurisdiction rule is hardcoded": "Không hardcode quy tắc theo khu vực pháp lý.",
  "Attendance, overtime, break and exception evidence": "Bằng chứng chấm công, tăng ca, giờ nghỉ và ngoại lệ.",
  "Timezone-aware configurable payroll frequency": "Tần suất bảng lương có cấu hình theo múi giờ.",
  "Ready periods from locked timesheet windows": "Kỳ sẵn sàng từ các khoảng bảng công đã khóa.",
  "Deterministic sources, independent approval and immutable finalize": "Nguồn dữ liệu xác định, phê duyệt độc lập và chốt kỳ bất biến.",
  "Blocking source, policy, currency and payout readiness issues": "Các vấn đề chặn nguồn, chính sách, tiền tệ và điều kiện chi trả.",
  "Private immutable finalized statements": "Phiếu lương riêng tư, bất biến sau khi chốt.",
  "Earnings, commission, tips and source reconciliation": "Thu nhập, hoa hồng, tiền tip và đối soát nguồn.",
  "No PAID state without external or approved manual evidence": "Không ghi nhận đã chi nếu thiếu bằng chứng bên ngoài hoặc phê duyệt thủ công.",
  "Expected, confirmed, reversed and variance evidence": "Bằng chứng dự kiến, xác nhận, đảo và chênh lệch.",
  "Effective-dated pay configuration and payout readiness": "Cấu hình lương theo thời điểm hiệu lực và điều kiện chi trả.",
};
const workforceColumnLabels: Record<string, string> = {
  id: "Mã bản ghi", tenantId: "Tenant", branchId: "Chi nhánh", staffId: "Nhân sự", shiftId: "Ca làm",
  deviceId: "Thiết bị", clockInEventId: "Sự kiện vào ca", clockOutEventId: "Sự kiện ra ca", employeeCode: "Mã nhân sự", displayName: "Tên hiển thị", status: "Trạng thái",
  version: "Phiên bản", startAt: "Bắt đầu", endAt: "Kết thúc", scheduledAt: "Theo lịch", actualAt: "Thực tế",
  clockInAt: "Giờ vào", clockOutAt: "Giờ ra", dueAt: "Hạn xử lý", createdAt: "Ngày tạo", updatedAt: "Cập nhật",
  periodId: "Kỳ bảng công", payrollRunId: "Kỳ bảng lương", leaveRequestId: "Đơn nghỉ", exceptionId: "Ngoại lệ", currency: "Tiền tệ", totalMinor: "Tổng tiền",
};
const workforceValueLabels: Record<string, string> = {
  ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", OPEN: "Đang mở", CLOSED: "Đã đóng", OFF: "Ngoài ca",
  PRESENT: "Có mặt", ABSENT: "Vắng mặt", LATE: "Đi muộn", ON_BREAK: "Đang nghỉ", MISSED: "Thiếu lượt chấm",
  IN_PROGRESS: "Đang xử lý", PENDING: "Đang chờ", SUBMITTED: "Đã gửi", LOCKED: "Đã khóa", VOIDED: "Đã vô hiệu",
  HOURLY: "Theo giờ", SALARY: "Theo lương", COMMISSION_ONLY: "Chỉ hoa hồng", HOURLY_PLUS_COMMISSION: "Theo giờ + hoa hồng",
  SALARY_PLUS_COMMISSION: "Theo lương + hoa hồng",
};
function workforceText(value: string) { return workforceLabels[value] ?? workforceValueLabels[value] ?? value; }
function workforceColumn(value: string) { return workforceColumnLabels[value] ?? value.replaceAll("_", " ").replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function workforceAction(value: string) {
  const labels: Record<string, string> = { acknowledge: "Xác nhận", resolve: "Xử lý", waive: "Miễn trừ", revoke: "Thu hồi", submit: "Gửi duyệt", approve: "Phê duyệt", reject: "Từ chối", reopen: "Mở lại", lock: "Khóa", calculate: "Tính toán", recalculate: "Tính lại", finalize: "Chốt kỳ", "request-void": "Yêu cầu vô hiệu", "approve-void": "Phê duyệt vô hiệu", process: "Xử lý", cancel: "Hủy" };
  return labels[value] ?? value;
}
function workforceValue(value: any, key = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  if (key === "id" || key.endsWith("Id") || key.endsWith("ID") || normalizedKey.endsWith(" id") || normalizedKey.endsWith(" uuid")) return "Mã hệ thống";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") return value.displayName ?? value.name ?? value.code ?? "Thông tin liên quan";
  if (typeof value === "string" && value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${(name ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return "Mã hệ thống";
  const mapped = workforceValueLabels[String(value).toUpperCase()];
  if (mapped) return mapped;
  if (/(at|date|start|end|from|to|due)$/.test(normalizedKey) && !Number.isNaN(Date.parse(String(value)))) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  return String(value);
}
async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init),
    body = await response.json().catch(() => ({}));
  if ([401, 403].includes(response.status))
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok)
    throw new Error(
      `${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Retry safely"}`,
    );
  return body.data;
}
async function command(path: string, body: any) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Payroll and clock writes are not queued offline.",
    );
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
export default function Sprint12Screen({ pathname }: { pathname: string }) {
  const payProfile = pathname.match(/^\/admin\/staff\/([^/]+)\/pay-profile$/);
  const detail = pathname.match(
    /^\/admin\/(payroll\/runs|payouts|timesheets)\/([^/]+)$/,
  );
  if (payProfile) {
    return (
      <Workspace
        config={{
          title: "Staff pay profile",
          endpoint: `/v1/staff/${payProfile[1]}/pay-profile`,
          create: `/v1/staff/${payProfile[1]}/pay-profile/update`,
          hint: "Effective-dated pay configuration and payout readiness",
        }}
      />
    );
  }
  const normalized = detail
    ? `/admin/${detail[1]}`
    : (Object.keys(configs)
        .sort((a, b) => b.length - a.length)
        .find((x) => pathname === x || pathname.startsWith(`${x}/`)) ??
      "/admin/time-clock");
  const cfg = configs[normalized]!;
  return <Workspace config={cfg} detailId={detail?.[2]} />;
}
 // PostgreSQL remains the authoritative source; the browser only reflects the API state.
 function Workspace({
  config,
  detailId,
}: {
  config: Config;
  detailId?: string | undefined;
}) {
  const endpoint = detailId
      ? `${config.endpoint}/${detailId}`
      : config.endpoint,
    [state, setState] = useState<State>("loading"),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [json, setJson] = useState("{}");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const raw = await api(endpoint),
        list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      setRows(list);
      setState(list.length ? "ready" : "empty");
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }, [endpoint]);
  useEffect(() => void load(), [load]);
  const columns = useMemo(
    () =>
      Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
        .filter(
          (key) =>
            ![
              "policyJson",
              "statementJson",
              "snapshotJson",
              "locationEvidenceJson",
            ].includes(key),
        )
        .slice(0, 8),
    [rows],
  );
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await command(config.create!, JSON.parse(json));
      setNotice("Saved. Authoritative data was refreshed.");
      await load();
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }
  async function act(row: any, action: string) {
    try {
      await command(`${config.endpoint}/${row.id}/${action}`, {
        version: row.version,
        reason: "Reviewed in Sprint 12 operations workspace",
      });
      setNotice(`${action} completed.`);
      await load();
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        {nav.map((href) => (
          <a key={href} href={href}>
            {workforceText(configs[href]?.title ?? href)}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">NAILSOFT · NHÂN SỰ & BẢNG LƯƠNG</p>
        <div className="title-row">
          <div>
            <h1>{workforceText(config.title)}</h1>
            <p className="hint">{workforceText(config.hint)}</p>
          </div>
          <span className="timezone">Dữ liệu máy chủ · Sổ theo UTC</span>
        </div>
        {notice && <p className="success">{notice}</p>}
        {state === "loading" && (
          <div className="skeleton">Đang tải dữ liệu nhân sự từ máy chủ…</div>
        )}
        {state === "forbidden" && (
          <div className="state">
            <h2>Không có quyền truy cập</h2>
            <p>Vai trò, tenant hoặc phạm vi chi nhánh hiện tại không bao gồm màn hình này.</p>
          </div>
        )}
        {state === "error" && (
          <div className="state">
            <h2>Không thể tải dữ liệu</h2>
            <p>{error}</p>
            <button onClick={() => void load()}>Thử lại</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <h2>Chưa có dữ liệu</h2>
            <p>Chưa có bản ghi phù hợp trong phạm vi được cấp quyền.</p>
            <button onClick={() => void load()}>Làm mới</button>
          </div>
        )}
        {state === "ready" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c} scope="col">{workforceColumn(c)}</th>
                  ))}
                  {config.actions && <th scope="col">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c} data-label={workforceColumn(c)}>{workforceValue(row[c], c)}</td>
                    ))}
                    {config.actions && (
                      <td className="actions">
                        {config.actions.map((a) => (
                          <button key={a} onClick={() => void act(row, a)}>{workforceAction(a)}</button>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {config.create && (
          <form onSubmit={create} className="form-grid">
            <label className="full">
              Dữ liệu lệnh (được API kiểm tra)
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={7}
              />
            </label>
            <button type="submit">Tạo mới</button>
          </form>
        )}
        <p className="hint">
          Sự kiện realtime chỉ kích hoạt tải lại; PostgreSQL vẫn là nguồn dữ liệu chính thức.
          Thông tin nhạy cảm về thiết bị, vị trí và phiếu lương không hiển thị trong danh sách.
        </p>
      </section>
    </main>
  );
}
