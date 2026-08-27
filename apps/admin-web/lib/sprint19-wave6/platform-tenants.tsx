"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { formatMinor, Status, readApi, rowsFrom, wave6Area } from "./shared";
import type { Wave6Route } from "./routes";

function tenantValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function tenantName(value: any, fallback = "Tenant chưa đặt tên") {
  if (value && typeof value === "object") return String(value["vi-VN"] ?? value.vi ?? value["en-US"] ?? value.en ?? value.name ?? value.code ?? fallback);
  return value == null || value === "" ? fallback : String(value);
}

function tenantDate(value: any) {
  if (!value) return "Chưa có";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function TenantDetail({ route, tenantId, suffix }: { route: Wave6Route; tenantId: string; suffix: string | undefined }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden" | "offline">("loading");
  const [tenant, setTenant] = useState<any>(null);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setError("");
    const paths = [
      `/v1/platform/tenants/${encodeURIComponent(tenantId)}`,
      ...(suffix === "entitlements" || suffix === "usage" || !suffix ? [`/v1/platform/tenants/${encodeURIComponent(tenantId)}/entitlements`] : []),
      ...(suffix === "invoices" || !suffix ? [`/v1/platform/tenants/${encodeURIComponent(tenantId)}/invoices`] : []),
      ...(suffix === "payments" || !suffix ? [`/v1/platform/tenants/${encodeURIComponent(tenantId)}/payments`] : []),
    ];
    const results = await Promise.allSettled(paths.map((path) => readApi(path)));
    const first = results[0];
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (first?.status === "rejected" && first.reason?.forbidden) {
      setState(rejected.length === results.length ? "forbidden" : "error");
      setError("Quyền hiện tại không bao gồm dữ liệu Tenant đích.");
      return;
    }
    if (first?.status !== "fulfilled") {
      setState(rejected.every((result) => result.reason?.forbidden) ? "forbidden" : "error");
      setError("Không thể tải bối cảnh Tenant từ máy chủ.");
      return;
    }
    setTenant(first.value);
    const values = results.map((result) => result.status === "fulfilled" ? result.value : []);
    const offset = 1;
    const entitlementIndex = paths.findIndex((path) => path.endsWith("/entitlements"));
    const invoiceIndex = paths.findIndex((path) => path.endsWith("/invoices"));
    const paymentIndex = paths.findIndex((path) => path.endsWith("/payments"));
    setEntitlements(entitlementIndex >= offset ? rowsFrom(values[entitlementIndex]) : []);
    setInvoices(invoiceIndex >= offset ? rowsFrom(values[invoiceIndex]) : []);
    setPayments(paymentIndex >= offset ? rowsFrom(values[paymentIndex]) : []);
    if (rejected.length) setError("Một số bối cảnh thanh toán Tenant chưa tải được; phần còn lại vẫn được hiển thị.");
    setState("ready");
  }, [suffix, tenantId]);
  useEffect(() => { void load(); }, [load]);
  const title = tenantName(tenant?.name ?? tenant?.displayName, "Chi tiết Tenant");
  const active = /ACTIVE|FULL|HEALTHY/i.test(String(tenantValue(tenant, "status", "accessMode", "subscriptionStatus") ?? ""));
  return <main className="shell ops-shell ns-platform-tenant-detail">
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={title} description="Bối cảnh Tenant chỉ hiển thị dữ liệu nền tảng; không mở rộng sang khách hàng, lịch hẹn, bảng lương hoặc POS salon." actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {state === "loading" && <StatePanel state="loading" title="Đang tải bối cảnh Tenant" detail="Đang kiểm tra quyền, gói và bằng chứng thanh toán của Tenant đích…" />}
    {state === "forbidden" && <section className="ns-platform-access-boundary" aria-label="Giới hạn quyền nền tảng"><span className="ns-platform-access-icon" aria-hidden="true">⌁</span><div><p className="eyebrow">PHẠM VI NỀN TẢNG</p><h2>Không có quyền xem Tenant này</h2><p>Quyền salon hiện tại không bao gồm dữ liệu Tenant đích. Không có thông tin tồn tại, hóa đơn hoặc thanh toán nào được suy đoán từ mã trên URL.</p><div className="ns-platform-access-actions"><a className="ns-button ns-button--secondary" href="/admin/support-access">Xem quyền hỗ trợ</a><a className="ns-button ns-button--secondary" href="/platform/tenants">Về danh sách Tenant</a></div></div></section>}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Bối cảnh Tenant có thể chưa phải mới nhất." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải bối cảnh Tenant" detail={error} onRetry={() => void load()} />}
    {state === "ready" && <>
      {error && <p className="ns-gallery-banner" role="status">{error}</p>}
      <section className="ns-platform-tenant-detail-hero"><div><p className="eyebrow">TENANT ĐÍCH</p><h2>{title}</h2><p>{tenantName(tenantValue(tenant, "slug"), "Mã Tenant do máy chủ cung cấp")}</p></div><Status value={tenantValue(tenant, "accessMode", "status", "subscriptionStatus") ?? "UNKNOWN"} /></section>
      <section className="ns-platform-tenant-detail-kpis" aria-label="Tóm tắt Tenant"><article><span>Trạng thái truy cập</span><strong>{active ? "Đang hoạt động" : "Theo máy chủ"}</strong><small>{tenantName(tenantValue(tenant, "accessMode"), "Chưa có")}</small></article><article><span>Quyền sử dụng</span><strong>{entitlements.length}</strong><small>Nhóm quyền được tải</small></article><article><span>Hóa đơn</span><strong>{invoices.length}</strong><small>Bằng chứng trong phạm vi Tenant</small></article><article><span>Thanh toán</span><strong>{payments.length}</strong><small>Ý định thanh toán đã lưu</small></article></section>
      <section className="ns-platform-tenant-detail-grid"><Card className="ns-platform-tenant-detail-card"><header><p className="eyebrow">HỒ SƠ TENANT</p><h2>Thông tin nền tảng</h2></header><dl><div><dt>Mã định danh</dt><dd>{tenantName(tenantValue(tenant, "slug"), "Chưa có")}</dd></div><div><dt>Gói</dt><dd>{tenantName(tenantValue(tenant, "planCode", "subscriptionStatus"), "Chưa có")}</dd></div><div><dt>Trạng thái vòng đời</dt><dd><Status value={tenantValue(tenant, "lifecycleStatus", "status") ?? "UNKNOWN"} /></dd></div><div><dt>Cập nhật</dt><dd>{tenantDate(tenantValue(tenant, "updatedAt", "createdAt"))}</dd></div></dl><a className="ns-button ns-button--secondary" href="/platform/tenants">Về danh sách Tenant</a></Card><Card className="ns-platform-tenant-detail-card"><header><p className="eyebrow">QUYỀN SỬ DỤNG</p><h2>Entitlement & usage</h2></header>{entitlements.length ? <ul className="ns-platform-tenant-detail-list">{entitlements.slice(0, 8).map((row, index) => <li key={String(tenantValue(row, "id", "code") ?? index)}><span><strong>{tenantName(tenantValue(row, "code", "name"))}</strong><small>{tenantName(tenantValue(row, "source"), "Nguồn do máy chủ cung cấp")}</small></span><b>{tenantValue(row, "value", "quantity", "limit") == null ? "—" : String(tenantValue(row, "value", "quantity", "limit"))}</b></li>)}</ul> : <p className="ns-platform-tenant-detail-empty">Chưa có nhóm quyền sử dụng trong phạm vi được cấp.</p>}</Card><Card className="ns-platform-tenant-detail-card"><header><p className="eyebrow">HÓA ĐƠN</p><h2>Hóa đơn Tenant</h2></header>{invoices.length ? <ul className="ns-platform-tenant-detail-list">{invoices.slice(0, 6).map((row, index) => <li key={String(tenantValue(row, "id", "invoiceNumber") ?? index)}><span><strong>{tenantName(tenantValue(row, "invoiceNumber"), "Hóa đơn nền tảng")}</strong><small>{tenantDate(tenantValue(row, "dueAt", "createdAt"))}</small></span><b>{tenantValue(row, "totalMinor") == null ? "—" : formatMinor(tenantValue(row, "totalMinor"), String(tenantValue(row, "currency") ?? "VND"))}</b></li>)}</ul> : <p className="ns-platform-tenant-detail-empty">Chưa có hóa đơn trong bối cảnh này.</p>}</Card><Card className="ns-platform-tenant-detail-card"><header><p className="eyebrow">THANH TOÁN</p><h2>Ý định thanh toán</h2></header>{payments.length ? <ul className="ns-platform-tenant-detail-list">{payments.slice(0, 6).map((row, index) => <li key={String(tenantValue(row, "id", "invoiceId") ?? index)}><span><strong>{tenantName(tenantValue(row, "provider"), "Nhà cung cấp")}</strong><small>{tenantDate(tenantValue(row, "createdAt"))}</small></span><span><Status value={tenantValue(row, "status") ?? "UNKNOWN"} /></span></li>)}</ul> : <p className="ns-platform-tenant-detail-empty">Chưa có thanh toán trong bối cảnh này.</p>}</Card></section>
    </>}
  </main>;
}

function PlatformTenantDirectory({ route }: { route: Wave6Route }) {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "forbidden" | "offline">("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const value = await readApi("/v1/platform/tenants");
      const next = rowsFrom(value);
      setRows(next);
      setState(next.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải danh sách Tenant.");
      setState(cause?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const activeCount = useMemo(() => rows.filter((row) => /ACTIVE|HEALTHY/i.test(String(tenantValue(row, "subscriptionStatus", "status", "state") ?? ""))).length, [rows]);
  return <main className="shell ops-shell ns-platform-tenant-directory">
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title="Danh sách Tenant" description="Khu vực quản trị cấp nền tảng; phiên hỗ trợ chỉ được phép trong Tenant đích đã được cấp quyền." actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {state === "loading" && <StatePanel state="loading" title="Đang kiểm tra phạm vi Tenant" detail="Đang đọc danh sách Tenant theo quyền hiện tại…" />}
    {state === "forbidden" && <section className="ns-platform-access-boundary" aria-label="Giới hạn quyền nền tảng"><span className="ns-platform-access-icon" aria-hidden="true">⌁</span><div><p className="eyebrow">PHẠM VI NỀN TẢNG</p><h2>Khu vực này cần quyền Platform Admin</h2><p>Quyền salon hiện tại không bao gồm danh sách Tenant toàn nền tảng. Dữ liệu vận hành salon không bị mở rộng từ màn hình này.</p><div className="ns-platform-access-actions"><a className="ns-button ns-button--secondary" href="/admin/support-access">Xem quyền hỗ trợ</a><a className="ns-button ns-button--secondary" href="/admin/organization/general">Về cài đặt salon</a></div></div></section>}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Không thể kiểm tra phạm vi Platform khi mất mạng." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải danh sách Tenant" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <StatePanel state="empty" title="Chưa có Tenant trong phạm vi" detail="Máy chủ không trả về Tenant nào theo quyền và phạm vi hiện tại." onRetry={() => void load()} />}
    {state === "ready" && <>
      <section className="ns-platform-tenant-summary" aria-label="Tóm tắt Tenant"><article><span>Tenant trong phạm vi</span><strong>{rows.length}</strong><small>Danh sách do máy chủ trả về</small></article><article><span>Đang hoạt động</span><strong>{activeCount}</strong><small>Trạng thái gói hoặc Tenant thực tế</small></article><article><span>Quyền dữ liệu</span><strong>Giới hạn</strong><small>Không mở dữ liệu salon ngoài phạm vi</small></article></section>
      <Card className="ns-platform-tenant-card"><header><div><p className="eyebrow">DANH MỤC TENANT</p><h2>Tenant được cấp quyền</h2><p>Chọn một Tenant thật để xem bối cảnh thanh toán nền tảng. Không hiển thị khách hàng, lịch hẹn hoặc POS salon ở đây.</p></div></header><div className="ns-platform-tenant-list">{rows.map((row, index) => <a className="ns-platform-tenant-row" href={tenantValue(row, "id") ? `/platform/tenants/${encodeURIComponent(String(tenantValue(row, "id")))}` : "/platform/tenants"} key={String(tenantValue(row, "id", "slug") ?? index)}><span className="ns-platform-tenant-mark" aria-hidden="true">N</span><span><strong>{tenantName(tenantValue(row, "name", "displayName"))}</strong><small>{tenantName(tenantValue(row, "slug"), "Mã Tenant do máy chủ cung cấp")}</small></span><span><small>Gói</small><strong>{tenantName(tenantValue(row, "planCode", "subscriptionStatus"), "Chưa có")}</strong></span><Status value={tenantValue(row, "subscriptionStatus", "status", "state") ?? "UNKNOWN"} /><span className="ns-platform-tenant-arrow" aria-hidden="true">→</span></a>)}</div></Card>
    </>}
  </main>;
}

export default function PlatformTenantsWorkspace({ route }: { route: Wave6Route }) {
  const match = route.href.match(/^\/platform\/tenants\/([^/]+)(?:\/(.*))?$/); const tenantId = match?.[1]; const suffix = match?.[2];
  if (!tenantId || tenantId === "detail") return <PlatformTenantDirectory route={route} />;
  return <TenantDetail route={route} tenantId={tenantId} suffix={suffix} />;
}
