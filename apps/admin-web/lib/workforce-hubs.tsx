/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "./auth";

type Kind = "staff" | "clock" | "payroll";
type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";

const kindMeta: Record<Kind, { title: string; eyebrow: string; description: string; endpoint: string }> = {
  staff: { title: "Đội ngũ nhân sự", eyebrow: "NHÂN SỰ · HỒ SƠ", description: "Tra cứu hồ sơ, hình thức làm việc và phạm vi vận hành của nhân sự.", endpoint: "/v1/staff" },
  clock: { title: "Chấm công thời gian thực", eyebrow: "NHÂN SỰ · CHẤM CÔNG", description: "Theo dõi phiên chấm công theo thời gian máy chủ và trạng thái cần rà soát.", endpoint: "/v1/time-clock/sessions" },
  payroll: { title: "Kỳ chạy bảng lương", eyebrow: "NHÂN SỰ · BẢNG LƯƠNG", description: "Kiểm tra nguồn dữ liệu, tính toán, phê duyệt và chốt kỳ theo kiểm soát kép.", endpoint: "/v1/payroll/runs" },
};

function rowsFrom(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.rows)) return value.rows;
  if (value && Array.isArray(value.records)) return value.records;
  return value ? [value] : [];
}

function unwrap(body: any) { return body?.data ?? body; }

function label(value: any) {
  if (value == null || value === "") return "—";
  const map: Record<string, string> = {
    ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", OPEN: "Đang mở", CLOSED: "Đã đóng",
    PRESENT: "Có mặt", ABSENT: "Vắng mặt", LATE: "Đi muộn", ON_BREAK: "Đang nghỉ", MISSED: "Thiếu lượt chấm",
    DRAFT: "Bản nháp", CALCULATED: "Đã tính", PENDING_APPROVAL: "Chờ phê duyệt", APPROVED: "Đã phê duyệt",
    FINALIZED: "Đã chốt", FAILED: "Thất bại", VOID_PENDING: "Chờ vô hiệu", VOIDED: "Đã vô hiệu",
    REGULAR: "Định kỳ", SUPPLEMENTAL: "Bổ sung", CORRECTION: "Điều chỉnh", FULL_TIME: "Toàn thời gian",
    PART_TIME: "Bán thời gian", TEMPORARY: "Tạm thời", HOURLY: "Theo giờ", SALARY: "Theo lương",
  };
  return map[String(value).toUpperCase()] ?? String(value).replaceAll("_", " ");
}

function fieldValue(value: any, key: string) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return value.displayName ?? value.name ?? value.code ?? "Thông tin liên quan";
  if (key.toLowerCase().endsWith("id") || key === "id") return "Mã hệ thống";
  if (typeof value === "string" && (key.toLowerCase().endsWith("at") || key.toLowerCase().endsWith("date"))) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  return label(value);
}

function moneyMinor(value: any, currency = "VND") {
  if (value == null || value === "") return "—";
  try {
    const amount = typeof value === "bigint" ? value : BigInt(String(value));
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const text = new Intl.NumberFormat("vi-VN").format(Number(absolute));
    return `${negative ? "-" : ""}${text} ${currency}`;
  } catch { return label(value); }
}

function displayName(row: any) {
  if (!row.displayName && !row.name && !row.staffName && (row.payrollPeriodId || row.payroll_period_id || row.runType || row.run_type)) return "Kỳ lương";
  if (!row.displayName && !row.name && !row.staffName && (row.clockInEventId || row.clock_in_event_id || row.clockOutEventId || row.clock_out_event_id || row.clockInAt || row.clock_in_at)) return "Phiên chấm công";
  return row.displayName ?? row.name ?? row.staffName ?? row.employeeCode ?? "Bản ghi nhân sự";
}

function stateTone(value: any) {
  const status = String(value ?? "").toUpperCase();
  if (["ACTIVE", "PRESENT", "APPROVED", "FINALIZED", "CALCULATED"].includes(status)) return "is-good";
  if (["PENDING_APPROVAL", "OPEN", "ON_BREAK", "LATE", "VOID_PENDING"].includes(status)) return "is-warning";
  if (["FAILED", "VOIDED", "ABSENT", "MISSED"].includes(status)) return "is-danger";
  return "is-neutral";
}

function actionFor(kind: Kind, row: any) {
  if (kind !== "payroll") return [] as string[];
  const status = String(row.state ?? row.status ?? "").toUpperCase();
  if (status === "DRAFT") return ["calculate"];
  if (status === "CALCULATED" || status === "FAILED") return ["recalculate", "submit"];
  if (status === "PENDING_APPROVAL") return ["approve"];
  if (status === "APPROVED") return ["finalize"];
  if (status === "VOID_PENDING") return ["approve-void"];
  return [];
}

function actionLabel(value: string) {
  return ({ calculate: "Tính kỳ", recalculate: "Tính lại", submit: "Gửi phê duyệt", approve: "Phê duyệt", finalize: "Chốt kỳ", "approve-void": "Phê duyệt vô hiệu" } as Record<string, string>)[value] ?? value;
}

function keyFor(row: any, index: number) { return String(row.id ?? row.staffId ?? row.payrollRunId ?? index); }

export default function WorkforceHub({ pathname }: { pathname: string }) {
  const kind: Kind = pathname === "/admin/staff/list" ? "staff" : pathname === "/admin/payroll/runs" || pathname.startsWith("/admin/payroll/runs/") ? "payroll" : "clock";
  const meta = kindMeta[kind];
  const detailId = kind === "payroll" ? pathname.match(/^\/admin\/payroll\/runs\/([^/]+)$/)?.[1] : undefined;
  const endpoint = detailId ? `${meta.endpoint}/${encodeURIComponent(detailId)}` : meta.endpoint;
  const [state, setState] = useState<AsyncState>("loading");
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(detailId ?? null);
  const [busy, setBusy] = useState(false);
  const intentKeys = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await authorizedFetch(endpoint);
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Không có quyền truy cập khu vực nhân sự này."), { forbidden: true });
      if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu từ máy chủ.");
      const values = rowsFrom(unwrap(body));
      setData(values);
      setSelectedId((current) => current ?? (values[0] ? keyFor(values[0], 0) : null));
      setState(values.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu từ máy chủ.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (state !== "ready") return;
    const region = document.querySelector<HTMLElement>(".workforce-table-wrap");
    if (region) {
      region.tabIndex = 0;
      region.setAttribute("aria-label", "Bảng dữ liệu có thể cuộn ngang");
    }
  }, [state]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi-VN");
    if (!normalized) return data;
    return data.filter((row) => JSON.stringify(row).toLocaleLowerCase("vi-VN").includes(normalized));
  }, [data, query]);
  const selected = filtered.find((row, index) => keyFor(row, index) === selectedId) ?? filtered[0] ?? null;

  const stats = useMemo(() => {
    const statuses = data.map((row) => String(row.state ?? row.status ?? "").toUpperCase());
    if (kind === "staff") return [
      ["Hồ sơ trong phạm vi", data.length.toString()],
      ["Đang hoạt động", statuses.filter((status) => status === "ACTIVE").length.toString()],
      ["Toàn thời gian", data.filter((row) => String(row.employmentType ?? row.employment_type ?? "").toUpperCase() === "FULL_TIME").length.toString()],
      ["Bán thời gian", data.filter((row) => String(row.employmentType ?? row.employment_type ?? "").toUpperCase() === "PART_TIME").length.toString()],
    ];
    if (kind === "clock") return [
      ["Phiên đang hiển thị", data.length.toString()],
      ["Đang làm việc", statuses.filter((status) => ["OPEN", "PRESENT"].includes(status)).length.toString()],
      ["Đang nghỉ", statuses.filter((status) => status === "ON_BREAK").length.toString()],
      ["Cần rà soát", statuses.filter((status) => ["LATE", "MISSED", "ABSENT"].includes(status)).length.toString()],
    ];
    return [
      ["Kỳ lương trong phạm vi", data.length.toString()],
      ["Chờ phê duyệt", statuses.filter((status) => status === "PENDING_APPROVAL").length.toString()],
      ["Đã chốt", statuses.filter((status) => status === "FINALIZED").length.toString()],
      ["Tổng tiền đã tính", moneyMinor(data.reduce((sum, row) => sum + Number(row.netPayMinor ?? row.net_pay_minor ?? 0), 0), data[0]?.currency ?? "VND")],
    ];
  }, [data, kind]);

  async function command(row: any, action: string) {
    if (!navigator.onLine) { setError("Đang ngoại tuyến. Thao tác nhân sự chỉ thực hiện khi có kết nối."); return; }
    const id = row.id ?? row.payrollRunId;
    if (!id) return;
    const intent = `${id}:${action}`;
    const idempotencyKey = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await authorizedFetch(`/v1/payroll/runs/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ version: row.version ?? 1, reason: "Thao tác từ màn hình bảng lương" }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.code === "VERSION_CONFLICT" ? "Kỳ lương vừa được cập nhật. Hãy tải lại trước khi thử lại." : body.error?.message ?? "Thao tác chưa được máy chủ chấp nhận.");
      delete intentKeys.current[intent];
      setNotice(`${actionLabel(action)} thành công. Dữ liệu đã được tải lại từ máy chủ.`);
      await load();
    } catch (cause: any) { setError(cause?.message ?? "Thao tác chưa hoàn tất."); } finally { setBusy(false); }
  }

  return <main className="shell ops-shell workforce-hub"><header className="workforce-header"><div><p className="eyebrow">{meta.eyebrow}</p><h1>{meta.title}</h1><p className="hint">{meta.description}</p></div><div className="workforce-header-actions"><button type="button" onClick={() => void load()} disabled={state === "loading"}>Làm mới</button>{kind === "staff" ? <a className="workforce-primary" href="/admin/staff/new">Thêm nhân sự</a> : null}</div></header>
    <nav className="workforce-nav" aria-label="Khu vực nhân sự"><a className={kind === "staff" ? "active" : ""} href="/admin/staff/list">Hồ sơ nhân sự</a><a className={kind === "clock" ? "active" : ""} href="/admin/time-clock">Chấm công</a><a className={kind === "payroll" ? "active" : ""} href="/admin/payroll/runs">Bảng lương</a></nav>
    <section className="workforce-kpis" aria-label="Tổng quan nhân sự">{stats.map(([title, value]) => <article className="workforce-kpi" key={title}><span>{title}</span><strong>{value}</strong><small>Dữ liệu trong phạm vi được cấp quyền</small></article>)}</section>
    {notice ? <p className="workforce-notice is-success" role="status">{notice}</p> : null}{error ? <p className="workforce-notice is-danger" role="alert">{error}</p> : null}
    <section className="workforce-layout"><div className="workforce-main"><div className="workforce-toolbar"><label htmlFor="workforce-search">Tìm kiếm trong dữ liệu đã tải<input id="workforce-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "staff" ? "Tên hoặc mã nhân sự" : kind === "clock" ? "Nhân sự hoặc trạng thái" : "Kỳ lương hoặc trạng thái"} /></label><span>{filtered.length} bản ghi đang hiển thị</span></div>{state === "loading" ? <div className="workforce-state" role="status">Đang tải dữ liệu từ máy chủ…</div> : null}{state === "forbidden" ? <div className="workforce-state" role="alert"><strong>Không có quyền truy cập</strong><span>{error}</span></div> : null}{state === "error" ? <div className="workforce-state" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div> : null}{state === "empty" ? <div className="workforce-state"><strong>Chưa có dữ liệu</strong><span>Chưa có bản ghi phù hợp trong phạm vi được cấp quyền.</span></div> : null}{state === "ready" ? <div className="workforce-table-wrap"><table><caption className="sr-only">{meta.title}</caption><thead><tr>{kind === "staff" ? <><th scope="col">Nhân sự</th><th scope="col">Mã</th><th scope="col">Hình thức</th><th scope="col">Trạng thái</th><th scope="col">Ngôn ngữ</th></> : kind === "clock" ? <><th scope="col">Nhân sự</th><th scope="col">Bắt đầu</th><th scope="col">Kết thúc</th><th scope="col">Trạng thái</th><th scope="col">Chi nhánh</th></> : <><th scope="col">Kỳ lương</th><th scope="col">Loại kỳ</th><th scope="col">Tiền tệ</th><th scope="col">Tổng lương</th><th scope="col">Trạng thái</th></>}</tr></thead><tbody>{filtered.map((row, index) => { const id = keyFor(row, index); const status = row.state ?? row.status; return <tr key={id} aria-selected={selectedId === id} className={selectedId === id ? "selected" : ""} onClick={() => setSelectedId(id)}>{kind === "staff" ? <><td><strong>{displayName(row)}</strong><small>{row.email ?? row.phone ?? "Thông tin liên hệ bị giới hạn"}</small></td><td>{row.employeeCode ?? row.employee_code ?? "—"}</td><td>{label(row.employmentType ?? row.employment_type)}</td><td><span className={`workforce-status ${stateTone(status)}`}>{label(status)}</span></td><td>{row.locale ?? "—"}</td></> : kind === "clock" ? <><td><strong>{displayName(row)}</strong><small>{fieldValue(row.staffId ?? row.staff_id, "staffId")}</small></td><td>{fieldValue(row.clockInAt ?? row.startAt ?? row.start_at, "clockInAt")}</td><td>{fieldValue(row.clockOutAt ?? row.endAt ?? row.end_at, "clockOutAt")}</td><td><span className={`workforce-status ${stateTone(status)}`}>{label(status)}</span></td><td>{fieldValue(row.branchId ?? row.branch_id, "branchId")}</td></> : <><td><strong>{row.payrollPeriodId ?? row.periodId ? "Kỳ lương" : "Kỳ chưa xác định"}</strong><small>{fieldValue(row.createdAt ?? row.created_at, "createdAt")}</small></td><td>{label(row.runType ?? row.run_type)}</td><td>{row.currency ?? "—"}</td><td>{moneyMinor(row.netPayMinor ?? row.net_pay_minor, row.currency ?? "VND")}</td><td><span className={`workforce-status ${stateTone(status)}`}>{label(status)}</span></td></>}</tr>; })}</tbody></table></div> : null}</div><aside className="workforce-inspector" aria-label="Chi tiết bản ghi">{selected ? <><div className="workforce-inspector-head"><span className="workforce-avatar">{displayName(selected).slice(0, 2).toUpperCase()}</span><div><h2>{displayName(selected)}</h2><p>{kind === "payroll" ? "Bằng chứng kỳ lương" : kind === "clock" ? "Phiên chấm công" : "Hồ sơ nhân sự"}</p><span className={`workforce-status ${stateTone(selected.state ?? selected.status)}`}>{label(selected.state ?? selected.status)}</span></div></div><dl className="workforce-details">{Object.entries(selected).filter(([key, value]) => value != null && value !== "" && !["policyJson", "statementJson", "snapshotJson", "locationEvidenceJson"].includes(key)).slice(0, 9).map(([key, value]) => <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dt><dd>{fieldValue(value, key)}</dd></div>)}</dl>{kind === "payroll" && actionFor(kind, selected).length ? <div className="workforce-actions"><h3>Thao tác được phép</h3>{actionFor(kind, selected).map((action) => <button type="button" key={action} disabled={busy} onClick={() => void command(selected, action)}>{actionLabel(action)}</button>)}</div> : null}{kind === "staff" && (selected.id ?? selected.staffId) ? <a className="workforce-link" href={`/admin/staff/${selected.id ?? selected.staffId}/pay-profile`}>Mở hồ sơ lương</a> : null}{kind === "payroll" && (selected.id ?? selected.payrollRunId) ? <a className="workforce-link" href={`/admin/payroll/runs/${selected.id ?? selected.payrollRunId}`}>Mở chi tiết kỳ lương</a> : null}</> : <div className="workforce-state"><strong>Chọn một bản ghi</strong><span>Chi tiết server và thao tác hợp lệ sẽ hiển thị tại đây.</span></div>}</aside></section><footer className="workforce-footer">Số liệu, quyền thao tác và phiên bản đều do máy chủ xác nhận. Trình duyệt không tự cập nhật trạng thái nghiệp vụ.</footer>
  </main>;
}
