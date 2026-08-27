/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "./auth";

type ControlKind = "branches" | "team" | "sessions";
type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";

const meta: Record<ControlKind, { title: string; eyebrow: string; description: string; endpoint: string }> = {
  branches: {
    title: "Chi nhánh",
    eyebrow: "KHÔNG GIAN · CHI NHÁNH",
    description: "Theo dõi phạm vi vận hành, múi giờ và trạng thái của các chi nhánh được cấp quyền.",
    endpoint: "/v1/branches",
  },
  team: {
    title: "Đội ngũ",
    eyebrow: "KIỂM SOÁT · ĐỘI NGŨ",
    description: "Quản lý thành viên không gian làm việc, vai trò và phạm vi chi nhánh.",
    endpoint: "/v1/users",
  },
  sessions: {
    title: "Phiên đăng nhập của tôi",
    eyebrow: "BẢO MẬT · PHIÊN ĐĂNG NHẬP",
    description: "Kiểm tra các thiết bị đang đăng nhập và thu hồi phiên không còn cần thiết.",
    endpoint: "/v1/auth/sessions",
  },
};

function unwrap(body: any): any[] {
  const value = body?.data ?? body;
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.rows)) return value.rows;
  return value ? [value] : [];
}

function idOf(row: any, index = 0) {
  return String(row?.id ?? row?.membershipId ?? row?.sessionId ?? index);
}

function dateValue(value: any) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(value: any) {
  const key = String(value ?? "").toUpperCase();
  return ({
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Không hoạt động",
    SUSPENDED: "Tạm ngưng",
    REVOKED: "Đã thu hồi",
    CURRENT: "Phiên hiện tại",
  } as Record<string, string>)[key] ?? (value ? String(value).replaceAll("_", " ") : "—");
}

function statusTone(value: any) {
  const key = String(value ?? "").toUpperCase();
  if (["ACTIVE", "CURRENT"].includes(key)) return "is-good";
  if (["SUSPENDED", "INACTIVE"].includes(key)) return "is-warning";
  if (["REVOKED"].includes(key)) return "is-danger";
  return "is-neutral";
}

function roleLabel(value: any) {
  const key = String(value ?? "").toUpperCase();
  return ({
    SALON_OWNER: "Chủ salon",
    BRANCH_MANAGER: "Quản lý chi nhánh",
    RECEPTIONIST: "Lễ tân",
    CASHIER: "Thu ngân",
    NAIL_TECHNICIAN: "Kỹ thuật viên",
    ACCOUNTANT: "Kế toán",
    MARKETING: "Marketing",
  } as Record<string, string>)[key] ?? (value ? String(value).replaceAll("_", " ") : "—");
}

function maskEmail(value: any) {
  if (!value || typeof value !== "string" || !value.includes("@")) return "Email bị giới hạn";
  const [name, domain] = value.split("@");
  return `${(name ?? "").slice(0, 2)}…@${domain}`;
}

function rowName(kind: ControlKind, row: any) {
  if (kind === "branches") return row.name ?? row.code ?? "Chi nhánh";
  if (kind === "team") return row.displayName ?? "Thành viên đội ngũ";
  return row.deviceName ?? "Thiết bị đăng nhập";
}

function statusFor(kind: ControlKind, row: any) {
  if (kind === "sessions") return row.isCurrent ? "CURRENT" : "ACTIVE";
  return row.status ?? row.membershipStatus ?? "UNKNOWN";
}

function roleNames(row: any) {
  const roles = Array.isArray(row?.roles) ? row.roles : [];
  return roles.map((role: any) => roleLabel(role?.role ?? role)).filter(Boolean);
}

function CreateControlForm({ kind, onCreated }: { kind: "branches" | "team"; onCreated: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({ timezone: "Asia/Ho_Chi_Minh", locale: "vi-VN", role: "RECEPTIONIST" });
  const [branches, setBranches] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const intentKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (kind !== "team") return;
    void authorizedFetch("/v1/branches").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      setBranches(unwrap(body));
    });
  }, [kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    intentKey.current ??= crypto.randomUUID();
    const body = kind === "branches"
      ? { name: values.name?.trim(), code: values.code?.trim().toUpperCase(), timezone: values.timezone, phone: values.phone?.trim() || null, address: {} }
      : { email: values.email?.trim(), displayName: values.displayName?.trim(), password: values.password, locale: values.locale, role: values.role, branchId: values.branchId || null };
    try {
      const response = await authorizedFetch(kind === "branches" ? "/v1/branches" : "/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": intentKey.current },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "Không thể tạo bản ghi.");
      intentKey.current = undefined;
      setNotice(kind === "branches" ? "Chi nhánh đã được tạo và dữ liệu đã được máy chủ xác nhận." : "Thành viên đã được mời và dữ liệu đã được máy chủ xác nhận.");
      event.currentTarget.reset();
      setValues({ timezone: "Asia/Ho_Chi_Minh", locale: "vi-VN", role: "RECEPTIONIST" });
      onCreated();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tạo bản ghi.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell ops-shell admin-control-hub"><header className="admin-control-header"><div><p className="eyebrow">{kind === "branches" ? "KHÔNG GIAN · CHI NHÁNH" : "KIỂM SOÁT · ĐỘI NGŨ"}</p><h1>{kind === "branches" ? "Thêm chi nhánh" : "Mời thành viên"}</h1><p className="hint">{kind === "branches" ? "Tạo không gian vận hành mới bằng thông tin được API kiểm tra." : "Mời thành viên bằng vai trò và phạm vi được máy chủ xác nhận."}</p></div><div className="admin-control-actions"><a className="admin-control-link" href={kind === "branches" ? "/admin/organization/branches" : "/admin/team/users"}>Quay lại danh sách</a></div></header><form id="admin-control-create-form" className="admin-control-create" onSubmit={submit}>{error ? <p className="admin-control-notice is-danger" role="alert">{error}</p> : null}{notice ? <p className="admin-control-notice is-success" role="status">{notice}</p> : null}{kind === "branches" ? <><label>Tên chi nhánh<input required minLength={1} value={values.name ?? ""} onChange={(event) => setValues((old) => ({ ...old, name: event.target.value }))} /></label><label>Mã chi nhánh<input required pattern="[A-Z0-9_-]+" value={values.code ?? ""} onChange={(event) => setValues((old) => ({ ...old, code: event.target.value.toUpperCase() }))} /></label><label>Múi giờ<input required value={values.timezone ?? ""} onChange={(event) => setValues((old) => ({ ...old, timezone: event.target.value }))} /></label><label>Số điện thoại (không bắt buộc)<input value={values.phone ?? ""} onChange={(event) => setValues((old) => ({ ...old, phone: event.target.value }))} /></label></> : <><label>Tên hiển thị<input required value={values.displayName ?? ""} onChange={(event) => setValues((old) => ({ ...old, displayName: event.target.value }))} /></label><label>Email công việc<input required type="email" value={values.email ?? ""} onChange={(event) => setValues((old) => ({ ...old, email: event.target.value }))} /></label><label>Mật khẩu tạm thời<input required minLength={10} type="password" autoComplete="new-password" value={values.password ?? ""} onChange={(event) => setValues((old) => ({ ...old, password: event.target.value }))} /></label><label>Vai trò<select value={values.role ?? "RECEPTIONIST"} onChange={(event) => setValues((old) => ({ ...old, role: event.target.value }))}><option value="RECEPTIONIST">Lễ tân</option><option value="BRANCH_MANAGER">Quản lý chi nhánh</option><option value="CASHIER">Thu ngân</option><option value="NAIL_TECHNICIAN">Kỹ thuật viên</option><option value="ACCOUNTANT">Kế toán</option><option value="MARKETING">Marketing</option></select></label><label>Chi nhánh<select value={values.branchId ?? ""} onChange={(event) => setValues((old) => ({ ...old, branchId: event.target.value }))}><option value="">Chọn theo phạm vi được cấp quyền</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name ?? branch.code}</option>)}</select></label></>}</form><div className="admin-control-create-actions"><button type="button" className="admin-control-link" onClick={() => window.history.back()}>Hủy</button><button type="submit" form="admin-control-create-form" disabled={busy}>{busy ? "Đang gửi…" : kind === "branches" ? "Tạo chi nhánh" : "Gửi lời mời"}</button></div></main>;
}

export default function AdminControlHub({ pathname }: { pathname: string }) {
  const isCreate = pathname.endsWith("/new");
  const routeId = !isCreate && (pathname.startsWith("/admin/organization/branches/") || pathname.startsWith("/admin/team/users/")) ? pathname.split("/")[4] : undefined;
  const kind: ControlKind = pathname.startsWith("/admin/organization/branches")
    ? "branches"
    : pathname.startsWith("/admin/team/users")
      ? "team"
      : "sessions";
  const current = meta[kind];
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(routeId ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const intentKeys = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await authorizedFetch(current.endpoint);
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Vai trò hiện tại không được phép xem khu vực này."), { forbidden: true });
      }
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu từ máy chủ.");
      const values = unwrap(body);
      setRows(values);
      setSelectedId((value) => value ?? routeId ?? (values[0] ? idOf(values[0], 0) : null));
      setState(values.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu từ máy chủ.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [current.endpoint, routeId]);

  useEffect(() => { if (!isCreate) void load(); }, [isCreate, load]);

  if (isCreate && kind !== "sessions") {
    return <CreateControlForm kind={kind} onCreated={() => window.location.assign(kind === "branches" ? "/admin/organization/branches" : "/admin/team/users")} />;
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi-VN");
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row).toLocaleLowerCase("vi-VN").includes(needle));
  }, [query, rows]);
  const selected = filtered.find((row, index) => idOf(row, index) === selectedId) ?? filtered[0] ?? null;

  const stats = useMemo(() => {
    if (kind === "branches") {
      return [
        ["Chi nhánh trong phạm vi", String(rows.length)],
        ["Đang hoạt động", String(rows.filter((row) => String(row.status).toUpperCase() === "ACTIVE").length)],
        ["Có múi giờ", String(rows.filter((row) => row.timezone).length)],
        ["Được chọn mặc định", String(rows.filter((row) => row.isPrimary || row.primary).length)],
      ];
    }
    if (kind === "team") {
      const roles = new Set(rows.flatMap((row) => roleNames(row)));
      return [
        ["Thành viên trong phạm vi", String(rows.length)],
        ["Đang hoạt động", String(rows.filter((row) => String(row.status).toUpperCase() === "ACTIVE").length)],
        ["Vai trò đang dùng", String(roles.size)],
        ["Có phân công chi nhánh", String(rows.filter((row) => Array.isArray(row.branchIds) && row.branchIds.length).length)],
      ];
    }
    return [
      ["Phiên đang hiển thị", String(rows.length)],
      ["Phiên hiện tại", String(rows.filter((row) => row.isCurrent).length)],
      ["Thiết bị gần đây", String(new Set(rows.map((row) => row.deviceName ?? row.platform).filter(Boolean)).size)],
      ["Còn hiệu lực", String(rows.filter((row) => row.expiresAt).length)],
    ];
  }, [kind, rows]);

  async function revoke(row: any) {
    const sessionId = row?.id;
    if (!sessionId || row.isCurrent) return;
    const key = `revoke:${sessionId}`;
    const idempotencyKey = intentKeys.current[key] ?? (intentKeys.current[key] = crypto.randomUUID());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authorizedFetch(`/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể thu hồi phiên đăng nhập.");
      delete intentKeys.current[key];
      setNotice("Phiên đã được thu hồi. Dữ liệu được tải lại từ máy chủ.");
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể thu hồi phiên đăng nhập.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell ops-shell admin-control-hub">
    <header className="admin-control-header">
      <div><p className="eyebrow">{current.eyebrow}</p><h1>{current.title}</h1><p className="hint">{current.description}</p></div>
      <div className="admin-control-actions"><button type="button" onClick={() => void load()} disabled={state === "loading"}>Làm mới</button>{kind === "branches" ? <a className="admin-control-primary" href="/admin/organization/branches/new">Thêm chi nhánh</a> : null}{kind === "team" ? <a className="admin-control-primary" href="/admin/team/users/new">Mời thành viên</a> : null}</div>
    </header>
    <nav className="admin-control-nav" aria-label="Khu vực kiểm soát"><a className={kind === "branches" ? "active" : ""} href="/admin/organization/branches">Chi nhánh</a><a className={kind === "team" ? "active" : ""} href="/admin/team/users">Đội ngũ</a><a className={kind === "sessions" ? "active" : ""} href="/admin/security/sessions">Phiên đăng nhập</a></nav>
    <section className="admin-control-kpis" aria-label="Tổng quan kiểm soát">{stats.map(([title, value]) => <article className="admin-control-kpi" key={title}><span>{title}</span><strong>{value}</strong><small>Dữ liệu trong phạm vi được cấp quyền</small></article>)}</section>
    {notice ? <p className="admin-control-notice is-success" role="status">{notice}</p> : null}
    {error ? <p className="admin-control-notice is-danger" role="alert">{error}</p> : null}
    <section className="admin-control-layout">
      <div className="admin-control-main">
        <div className="admin-control-toolbar"><label htmlFor="admin-control-search">Tìm trong dữ liệu đã tải<input id="admin-control-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "branches" ? "Tên hoặc mã chi nhánh" : kind === "team" ? "Tên, email hoặc vai trò" : "Thiết bị hoặc nền tảng"} /></label><span>{filtered.length} bản ghi đang hiển thị</span></div>
        {state === "loading" ? <div className="admin-control-state" role="status">Đang tải dữ liệu từ máy chủ…</div> : null}
        {state === "forbidden" ? <div className="admin-control-state" role="alert"><strong>Không có quyền truy cập</strong><span>{error}</span></div> : null}
        {state === "error" ? <div className="admin-control-state" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div> : null}
        {state === "empty" ? <div className="admin-control-state"><strong>Chưa có dữ liệu</strong><span>{kind === "branches" ? "Chưa có chi nhánh trong phạm vi được cấp quyền." : kind === "team" ? "Chưa có thành viên trong không gian làm việc." : "Không có phiên đăng nhập đang còn hiệu lực."}</span></div> : null}
        {state === "ready" ? <div className="admin-control-table-wrap"><table><caption className="sr-only">{current.title}</caption><thead><tr>{kind === "branches" ? <><th scope="col">Chi nhánh</th><th scope="col">Mã</th><th scope="col">Trạng thái</th><th scope="col">Múi giờ</th><th scope="col">Cập nhật</th></> : kind === "team" ? <><th scope="col">Thành viên</th><th scope="col">Vai trò</th><th scope="col">Phạm vi</th><th scope="col">Trạng thái</th><th scope="col">Ngôn ngữ</th></> : <><th scope="col">Thiết bị</th><th scope="col">Nền tảng</th><th scope="col">Hoạt động gần nhất</th><th scope="col">Hết hạn</th><th scope="col">Trạng thái</th></>}</tr></thead><tbody>{filtered.map((row, index) => { const rowId = idOf(row, index); const status = statusFor(kind, row); return <tr key={rowId} aria-selected={selectedId === rowId} className={selectedId === rowId ? "selected" : ""} onClick={() => setSelectedId(rowId)}>{kind === "branches" ? <><td><strong>{rowName(kind, row)}</strong><small>{row.address?.city ?? row.address?.district ?? "Thông tin vận hành"}</small></td><td>{row.code ?? "—"}</td><td><span className={`admin-control-status ${statusTone(status)}`}>{statusLabel(status)}</span></td><td>{row.timezone ?? "—"}</td><td>{dateValue(row.updatedAt ?? row.createdAt)}</td></> : kind === "team" ? <><td><strong>{rowName(kind, row)}</strong><small>{maskEmail(row.email)}</small></td><td>{roleNames(row).join(", ") || "Chưa gán vai trò"}</td><td>{Array.isArray(row.branchIds) && row.branchIds.length ? `${row.branchIds.length} chi nhánh` : "Toàn không gian"}</td><td><span className={`admin-control-status ${statusTone(status)}`}>{statusLabel(status)}</span></td><td>{row.locale ?? "—"}</td></> : <><td><strong>{rowName(kind, row)}</strong><small>{row.appVersion ?? "Phiên web"}</small></td><td>{row.platform ?? "—"}</td><td>{dateValue(row.lastSeenAt ?? row.createdAt)}</td><td>{dateValue(row.expiresAt)}</td><td><span className={`admin-control-status ${statusTone(status)}`}>{row.isCurrent ? "Phiên hiện tại" : "Đang hoạt động"}</span></td></>}</tr>; })}</tbody></table></div> : null}
      </div>
      <aside className="admin-control-inspector" aria-label="Chi tiết bản ghi">{selected ? <><div className="admin-control-inspector-head"><span className="admin-control-avatar">{rowName(kind, selected).slice(0, 2).toUpperCase()}</span><div><h2>{rowName(kind, selected)}</h2><p>{kind === "branches" ? "Phạm vi chi nhánh" : kind === "team" ? "Quyền thành viên" : "Bằng chứng phiên đăng nhập"}</p><span className={`admin-control-status ${statusTone(statusFor(kind, selected))}`}>{statusLabel(statusFor(kind, selected))}</span></div></div><dl className="admin-control-details">{kind === "branches" ? <><div><dt>Mã chi nhánh</dt><dd>{selected.code ?? "—"}</dd></div><div><dt>Múi giờ</dt><dd>{selected.timezone ?? "—"}</dd></div><div><dt>Điện thoại</dt><dd>{selected.phone ?? "Thông tin bị giới hạn"}</dd></div><div><dt>Ngày tạo</dt><dd>{dateValue(selected.createdAt)}</dd></div><div><dt>Cập nhật gần nhất</dt><dd>{dateValue(selected.updatedAt)}</dd></div></> : kind === "team" ? <><div><dt>Email</dt><dd>{maskEmail(selected.email)}</dd></div><div><dt>Vai trò</dt><dd>{roleNames(selected).join(", ") || "Chưa gán vai trò"}</dd></div><div><dt>Phạm vi chi nhánh</dt><dd>{Array.isArray(selected.branchIds) && selected.branchIds.length ? `${selected.branchIds.length} chi nhánh` : "Toàn không gian"}</dd></div><div><dt>Ngôn ngữ</dt><dd>{selected.locale ?? "—"}</dd></div><div><dt>Trạng thái thành viên</dt><dd>{statusLabel(selected.membershipStatus ?? selected.status)}</dd></div></> : <><div><dt>Nền tảng</dt><dd>{selected.platform ?? "—"}</dd></div><div><dt>Phiên hiện tại</dt><dd>{selected.isCurrent ? "Đúng" : "Không"}</dd></div><div><dt>Hoạt động gần nhất</dt><dd>{dateValue(selected.lastSeenAt)}</dd></div><div><dt>Hết hạn</dt><dd>{dateValue(selected.expiresAt)}</dd></div><div><dt>Tạo lúc</dt><dd>{dateValue(selected.createdAt)}</dd></div></>}</dl>{kind === "sessions" && !selected.isCurrent ? <button type="button" className="admin-control-danger" disabled={busy} onClick={() => void revoke(selected)}>Thu hồi phiên này</button> : null}{kind === "team" && selected.membershipId ? <a className="admin-control-link" href={`/admin/team/users/${selected.membershipId}`}>Mở hồ sơ quyền truy cập</a> : null}</> : <div className="admin-control-state"><strong>Chọn một bản ghi</strong><span>Chi tiết được xác nhận từ máy chủ sẽ hiển thị tại đây.</span></div>}</aside>
    </section>
    <footer className="admin-control-footer">Quyền truy cập, trạng thái và mốc thời gian đều do máy chủ xác nhận. Không hiển thị bí mật phiên trong giao diện.</footer>
  </main>;
}
