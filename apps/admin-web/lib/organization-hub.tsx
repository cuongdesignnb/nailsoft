/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "./auth";

type AsyncState = "loading" | "ready" | "error" | "forbidden";

function unwrapOne(body: any) {
  const value = body?.data ?? body;
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function statusLabel(value: any) {
  const key = String(value ?? "").toUpperCase();
  return ({ ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", SUSPENDED: "Tạm ngưng", READ_ONLY: "Chỉ đọc" } as Record<string, string>)[key] ?? (value ? String(value).replaceAll("_", " ") : "Chưa có trạng thái");
}

function dateValue(value: any) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function OrganizationHub() {
  const [state, setState] = useState<AsyncState>("loading");
  const [organization, setOrganization] = useState<any>(null);
  const [values, setValues] = useState({ name: "", defaultLocale: "vi-VN", currency: "VND", timezone: "Asia/Ho_Chi_Minh" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const intentKey = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await authorizedFetch("/v1/organization");
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền xem thông tin tổ chức."), { forbidden: true });
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải thông tin tổ chức.");
      const next = unwrapOne(body);
      setOrganization(next);
      setValues({ name: String(next?.name ?? ""), defaultLocale: String(next?.defaultLocale ?? "vi-VN"), currency: String(next?.currency ?? "VND"), timezone: String(next?.timezone ?? "Asia/Ho_Chi_Minh") });
      setState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải thông tin tổ chức.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    const intent = intentKey.current ?? crypto.randomUUID();
    intentKey.current = intent;
    try {
      const response = await authorizedFetch("/v1/organization", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": intent }, body: JSON.stringify(values) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Không thể cập nhật thông tin tổ chức.");
      intentKey.current = undefined;
      setNotice("Thông tin tổ chức đã được máy chủ xác nhận.");
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể cập nhật thông tin tổ chức.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell ops-shell organization-hub"><header className="organization-header"><div><p className="eyebrow">NAILSOFT · QUẢN TRỊ KHÔNG GIAN</p><h1>Thông tin tổ chức</h1><p className="hint">Giữ thông tin salon, mã định danh và vùng thời gian nhất quán với các nghiệp vụ đặt lịch và báo cáo.</p></div><nav className="organization-actions" aria-label="Cấu hình tổ chức"><a href="/admin/organization/branches">Chi nhánh</a><a href="/admin/team/users">Đội ngũ</a></nav></header>{state === "loading" ? <div className="organization-state" role="status" aria-busy="true">Đang tải thông tin tổ chức…</div> : null}{state === "forbidden" || state === "error" ? <div className="organization-state" role="alert"><h2>{state === "forbidden" ? "Không có quyền truy cập" : "Không thể tải dữ liệu"}</h2><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div> : null}{state === "ready" && organization ? <><section className="organization-overview"><article><span>Tên tổ chức</span><strong>{organization.name ?? "—"}</strong><small>Hiển thị trong không gian quản trị</small></article><article><span>Mã salon</span><strong>{organization.slug ?? "—"}</strong><small>Mã dùng cho các luồng công khai</small></article><article><span>Trạng thái</span><strong>{statusLabel(organization.status)}</strong><small>Dữ liệu do máy chủ xác nhận</small></article><article><span>Cập nhật gần nhất</span><strong>{dateValue(organization.updatedAt ?? organization.createdAt)}</strong><small>Không dùng làm mốc nghiệp vụ</small></article></section><div className="organization-layout"><form className="organization-form" onSubmit={submit}><div className="organization-section-heading"><div><p className="organization-kicker">CẤU HÌNH CƠ BẢN</p><h2>Thông tin hiển thị</h2></div><span>API PATCH</span></div>{notice ? <p className="organization-notice is-success" role="status">{notice}</p> : null}{error ? <p className="organization-notice is-danger" role="alert">{error}</p> : null}<label>Tên tổ chức<input required value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></label><label>Ngôn ngữ mặc định<select value={values.defaultLocale} onChange={(event) => setValues((current) => ({ ...current, defaultLocale: event.target.value }))}><option value="vi-VN">Tiếng Việt (vi-VN)</option><option value="en-US">English (en-US)</option></select></label><label>Tiền tệ<select value={values.currency} onChange={(event) => setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}><option value="VND">VND</option><option value="USD">USD</option></select></label><label>Múi giờ<input required value={values.timezone} onChange={(event) => setValues((current) => ({ ...current, timezone: event.target.value }))} /></label><div className="organization-form-actions"><button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button type="button" className="organization-secondary" onClick={() => void load()} disabled={busy}>Tải lại</button></div></form><aside className="organization-guidance"><p className="organization-kicker">PHẠM VI DỮ LIỆU</p><h2>Thông tin này ảnh hưởng đến đâu?</h2><ul><li>Mã salon được sử dụng khi mở luồng đặt lịch công khai.</li><li>Múi giờ là cơ sở hiển thị lịch và giờ hoạt động.</li><li>Tiền tệ được các domain tài chính kiểm tra ở phía máy chủ.</li></ul><div className="organization-safety"><strong>Thay đổi có kiểm soát</strong><span>Quyền cập nhật, access mode và audit log vẫn do API quyết định.</span></div></aside></div></> : null}</main>;
}
