"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { FieldForm, Status, formatMinor, readApi, rowsFrom, wave6Area, type AsyncState } from "./shared";
import type { Wave6Route } from "./routes";
import { commandApi } from "./shared";
import { getAuthContext } from "../auth";

type BillingOverviewState = "loading" | "ready" | "error" | "forbidden" | "offline";

function billingValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current == null ? undefined : current[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function billingName(value: any, fallback = "Chưa có thông tin") {
  if (value && typeof value === "object") return String(value["vi-VN"] ?? value.vi ?? value["en-US"] ?? value.en ?? value.name ?? value.code ?? fallback);
  return value == null || value === "" ? fallback : String(value);
}

function billingDate(value: any) {
  if (!value) return "Chưa có";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(date);
}

function BillingOverview({ route }: { route: Wave6Route }) {
  const [state, setState] = useState<BillingOverviewState>("loading");
  const [error, setError] = useState("");
  const [partialError, setPartialError] = useState("");
  const [data, setData] = useState<{ subscription: any[]; usage: any[]; invoices: any[]; methods: any[] }>({ subscription: [], usage: [], invoices: [], methods: [] });

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    setPartialError("");
    const requests = await Promise.allSettled([
      readApi("/v1/tenant/billing/subscription"),
      readApi("/v1/tenant/billing/usage"),
      readApi("/v1/tenant/billing/invoices"),
      readApi("/v1/tenant/billing/payment-methods"),
    ]);
    const rejected = requests.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected.length === requests.length && rejected.every((result) => result.reason?.forbidden)) {
      setState("forbidden");
      setError("Bạn không có quyền xem thanh toán gói trong phạm vi hiện tại.");
      return;
    }
    if (rejected.length) setPartialError("Một số nguồn thanh toán chưa tải được; phần dữ liệu còn lại vẫn hiển thị theo máy chủ.");
    const values = requests.map((result) => result.status === "fulfilled" ? rowsFrom(result.value) : []);
    setData({ subscription: values[0]!, usage: values[1]!, invoices: values[2]!, methods: values[3]! });
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const subscription = data.subscription[0];
  const activeUsage = useMemo(() => data.usage.filter((row) => String(billingValue(row, "status", "state") ?? "ACTIVE").toUpperCase() !== "INACTIVE"), [data.usage]);
  const outstandingInvoices = useMemo(() => data.invoices.filter((row) => !["PAID", "CANCELLED", "VOID"].includes(String(billingValue(row, "status", "state") ?? "").toUpperCase())), [data.invoices]);
  const latestInvoice = data.invoices[0];
  const latestMethod = data.methods[0];

  return <main className="shell ops-shell ns-billing-overview">
    <PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title="Tổng quan thanh toán gói" description="Theo dõi gói đăng ký, quyền truy cập, gia hạn và bằng chứng thu tiền do máy chủ cung cấp." actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {state === "loading" && <StatePanel state="loading" title="Đang tải thanh toán gói" detail="Đang đọc gói đăng ký và bằng chứng thanh toán…" />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail={error} onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Dữ liệu thanh toán có thể chưa phải mới nhất." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải thanh toán gói" detail={error} onRetry={() => void load()} />}
    {state === "ready" && <>
      {partialError && <p className="ns-gallery-banner" role="status">{partialError}</p>}
      <section className="ns-billing-summary" aria-label="Tóm tắt gói đăng ký">
        <article><span>Gói hiện tại</span><strong>{billingName(billingValue(subscription, "planName", "plan.name", "plan"), "Chưa có gói")}</strong><small>{billingValue(subscription, "planCode", "plan.code") ?? "Mã gói do máy chủ cung cấp"}</small></article>
        <article><span>Quyền sử dụng đang theo dõi</span><strong>{activeUsage.length}</strong><small>Chỉ số hiệu lực từ hợp đồng gói</small></article>
        <article><span>Hóa đơn cần xử lý</span><strong>{outstandingInvoices.length}</strong><small>Không tính hóa đơn đã thanh toán hoặc vô hiệu</small></article>
        <article><span>Phương thức đã lưu</span><strong>{data.methods.length}</strong><small>Chỉ hiển thị thông tin đã che</small></article>
      </section>

      <section className="ns-billing-hero" aria-label="Gói đăng ký hiện tại">
        <div className="ns-billing-hero-main"><p className="eyebrow">GÓI ĐĂNG KÝ HIỆN TẠI</p><h2>{billingName(billingValue(subscription, "planName", "plan.name", "plan"), "Chưa có gói đăng ký")}</h2><p>Trạng thái và thời điểm gia hạn được lấy nguyên trạng từ hợp đồng thanh toán của tenant.</p><div className="ns-billing-hero-meta"><span><small>Trạng thái</small><Status value={billingValue(subscription, "status", "state") ?? "UNKNOWN"} /></span><span><small>Gia hạn</small><strong>{billingDate(billingValue(subscription, "currentPeriodEnd", "current_period_end", "renewalAt"))}</strong></span><span><small>Phiên bản</small><strong>{billingValue(subscription, "version", "planVersion") ?? "—"}</strong></span></div></div>
        <div className="ns-billing-hero-actions"><a className="ns-button ns-button--primary" href="/admin/billing/subscription">Quản lý gói</a><a className="ns-button ns-button--secondary" href="/admin/billing/invoices">Xem hóa đơn</a></div>
      </section>

      <section className="ns-billing-grid" aria-label="Bằng chứng thanh toán">
        <Card className="ns-billing-panel"><header><div><p className="eyebrow">QUYỀN SỬ DỤNG</p><h2>Sản lượng & hạn mức</h2><p>Không tính lại entitlement ở trình duyệt; các chỉ số hiển thị theo projection của máy chủ.</p></div><a href="/admin/billing/usage">Xem chi tiết →</a></header>{activeUsage.length ? <ul className="ns-billing-list">{activeUsage.slice(0, 5).map((row, index) => <li key={String(billingValue(row, "id", "code") ?? index)}><span><strong>{billingName(billingValue(row, "name", "code"), "Chỉ số sử dụng")}</strong><small>{billingDate(billingValue(row, "periodStart", "period_start"))} – {billingDate(billingValue(row, "periodEnd", "period_end"))}</small></span><strong>{billingValue(row, "quantity", "used") ?? "—"} / {billingValue(row, "quota", "limit") ?? "—"}</strong></li>)}</ul> : <div className="ns-billing-empty"><strong>Chưa có chỉ số sử dụng</strong><span>Chưa có dữ liệu hạn mức trong phạm vi được cấp quyền.</span></div>}</Card>
        <Card className="ns-billing-panel"><header><div><p className="eyebrow">THU TIỀN</p><h2>Hóa đơn gần đây</h2><p>Hóa đơn gói nền tảng tách biệt với hóa đơn POS của salon.</p></div><a href="/admin/billing/history">Xem lịch sử →</a></header>{data.invoices.length ? <ul className="ns-billing-list">{data.invoices.slice(0, 5).map((row, index) => <li key={String(billingValue(row, "id", "invoiceNumber") ?? index)}><span><strong>{billingName(billingValue(row, "invoiceNumber", "reference"), "Hóa đơn nền tảng")}</strong><small>{billingDate(billingValue(row, "dueAt", "due_at", "createdAt"))}</small></span><span className="ns-billing-amount"><strong>{formatMinor(billingValue(row, "totalMinor", "total_minor", "amountMinor"), billingValue(row, "currency") ?? "VND")}</strong><Status value={billingValue(row, "status", "state") ?? "UNKNOWN"} /></span></li>)}</ul> : <div className="ns-billing-empty"><strong>Chưa có hóa đơn</strong><span>Chưa có bằng chứng hóa đơn trong phạm vi hiện tại.</span></div>}</Card>
      </section>

      <section className="ns-billing-safety" aria-label="An toàn thanh toán"><span aria-hidden="true">▣</span><div><strong>Phương thức thanh toán được bảo vệ</strong><p>{latestMethod ? `Phương thức gần nhất: ${billingName(billingValue(latestMethod, "provider", "methodType"), "Nhà cung cấp đã che")} · ${billingName(billingValue(latestMethod, "display", "maskedDisplay"), "Thông tin đã che")}.` : "Chưa có phương thức thanh toán được lưu trong phạm vi hiện tại."} Dữ liệu thẻ thô không được thu thập trong màn hình này.</p></div><a href="/admin/billing/payment-methods">Xem phương thức →</a></section>
      {latestInvoice && <p className="ns-gallery-caption">Bằng chứng mới nhất được cập nhật theo bản ghi hóa đơn: {billingDate(billingValue(latestInvoice, "createdAt", "created_at"))}.</p>}
    </>}
  </main>;
}

function planLabel(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record["vi-VN"] ?? record["en-US"] ?? record.name ?? record.code ?? "Gói dịch vụ");
  }
  return String(value ?? "Gói dịch vụ");
}

function ChangePlanForm({ subscription, options: publishedPlans }: { subscription: any; options: any[] }) {
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const next = publishedPlans.flatMap((plan: Record<string, unknown>) => plan.id ? [{ value: String(plan.id), label: planLabel(plan.name ?? plan.code) }] : []);
    if (next.length) { setOptions(next); setLoading(false); return () => { active = false; }; }
    void readApi("/v1/tenant/billing/plans").then((value) => {
      if (!active) return;
      setOptions(rowsFrom(value).flatMap((plan: Record<string, unknown>) => plan.id ? [{ value: String(plan.id), label: planLabel(plan.name ?? plan.code) }] : []));
    }).catch(() => { if (active) setOptions([]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publishedPlans]);
  if (loading) return <p className="hint">Đang tải danh sách gói dịch vụ…</p>;
  if (!options.length) return <p className="hint">Chưa có gói dịch vụ được công bố để chuyển đổi.</p>;
  return <FieldForm title="Đổi gói dịch vụ" initialValues={{ version: String(subscription.version ?? "") }} fields={[{ name: "planId", label: "Gói dịch vụ mới", options, required: true }, { name: "effectiveMode", label: "Thời điểm áp dụng", options: ["NEXT_PERIOD", "IMMEDIATE"], required: true }, { name: "changeType", label: "Loại thay đổi", options: ["UPGRADE", "DOWNGRADE"], required: true }, { name: "version", label: "Phiên bản hiện tại", type: "number", readOnly: true, required: true }]} onSubmit={async (values) => { await commandApi("/v1/tenant/billing/subscription/change-plan", values); }} note="Chọn gói từ danh sách thật. Máy chủ quyết định chênh lệch, tiền tệ và thời điểm hiệu lực." />;
}

function BillingBoundary({ title, detail }: { title: string; detail: string }) {
  return <Card className="ns-billing-resource-boundary"><p className="eyebrow">BẢO VỆ THANH TOÁN</p><h2>{title}</h2><p>{detail}</p><a className="ns-button ns-button--secondary" href="/admin/organization/general">Về quản trị salon</a></Card>;
}

type BillingResourceKind = "plans" | "usage" | "invoices" | "invoice-detail" | "methods";

function billingResourceConfig(path: string): { kind: BillingResourceKind; endpoint: string; title: string; description: string } | null {
  if (path === "/admin/billing/plans") return { kind: "plans", endpoint: "/v1/tenant/billing/plans", title: "Gói dịch vụ", description: "Các gói và bảng giá đã công bố trong hợp đồng thanh toán của salon." };
  if (path === "/admin/billing/usage") return { kind: "usage", endpoint: "/v1/tenant/billing/usage", title: "Sản lượng & hạn mức", description: "Projection quyền sử dụng do máy chủ cung cấp; trình duyệt không tự tính quota." };
  if (path === "/admin/billing/history" || path === "/admin/billing/invoices") return { kind: "invoices", endpoint: "/v1/tenant/billing/invoices", title: path === "/admin/billing/history" ? "Lịch sử thanh toán" : "Hóa đơn gói nền tảng", description: "Hóa đơn và trạng thái thu tiền bất biến, tách biệt với hóa đơn POS của salon." };
  if (path === "/admin/billing/invoices/detail") return { kind: "invoice-detail", endpoint: "", title: "Chi tiết hóa đơn", description: "Chọn một hóa đơn thật để xem bằng chứng chi tiết." };
  const match = path.match(/^\/admin\/billing\/invoices\/([^/]+)$/);
  if (match) return { kind: "invoice-detail", endpoint: `/v1/tenant/billing/invoices/${encodeURIComponent(match[1]!)}`, title: "Chi tiết hóa đơn", description: "Bằng chứng hóa đơn được đọc theo ID thật và vẫn tách biệt với POS." };
  if (path === "/admin/billing/payment-methods") return { kind: "methods", endpoint: "/v1/tenant/billing/payment-methods", title: "Phương thức thanh toán", description: "Chỉ hiển thị nhà cung cấp và dữ liệu đã che; không thu thập số thẻ thô." };
  return null;
}

function resourceCell(row: any, key: string) {
  const value = billingValue(row, key);
  if (value === undefined || value === null || value === "") return "—";
  if (key === "status" || key === "state") return <Status value={value} />;
  if (key.endsWith("Minor")) return formatMinor(value, String(billingValue(row, "currency") ?? "VND"));
  if (key.endsWith("At") || key.endsWith("Date") || key.startsWith("period")) return billingDate(value);
  if (key.endsWith("Id") || key === "id") return <span title={String(value)}>Mã hệ thống</span>;
  if (typeof value === "object") return billingName(value, "Đã có dữ liệu");
  return String(value);
}

function BillingResource({ route, config }: { route: Wave6Route; config: NonNullable<ReturnType<typeof billingResourceConfig>> }) {
  const [state, setState] = useState<AsyncState>(config.endpoint ? "loading" : "empty");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const intentKeys = useState(() => new Map<string, string>())[0];

  const load = useCallback(async () => {
    if (!config.endpoint) return;
    setState("loading"); setError("");
    const result = await Promise.allSettled([getAuthContext(), readApi(config.endpoint)]);
    if (result[0].status === "fulfilled") setPermissions(result[0].value.supportAccess?.permissions ?? result[0].value.authorization?.permissions ?? []);
    const data = result[1];
    if (data.status === "rejected") {
      const cause: any = data.reason;
      setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      setError(cause?.message ?? "Không thể tải dữ liệu thanh toán.");
      return;
    }
    const next = rowsFrom(data.value);
    setRows(next); setState(next.length ? "ready" : "empty");
  }, [config.endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function pay(row: any) {
    if (!row.id) return;
    const key = `pay:${row.id}`;
    let intentKey = intentKeys.get(key);
    if (!intentKey) { intentKey = crypto.randomUUID(); intentKeys.set(key, intentKey); }
    setBusy(key); setError(""); setNotice("");
    try { await commandApi(`/v1/tenant/billing/invoices/${row.id}/pay`, { version: row.version }, intentKey); setNotice("Máy chủ đã tiếp nhận yêu cầu thanh toán. Dữ liệu đang được tải lại."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tạo yêu cầu thanh toán."); }
    finally { setBusy(null); }
  }

  if (config.kind === "invoice-detail" && !config.endpoint) return <main className="shell ops-shell ns-billing-resource"><PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={config.title} description={config.description} actions={<a className="ns-button ns-button--secondary" href="/admin/billing/invoices">Về danh sách hóa đơn</a>} /><Card className="ns-billing-resource-empty"><strong>Chưa có hóa đơn được chọn</strong><p>Trang chi tiết cần một ID hóa đơn thật; không tạo dữ liệu mẫu hoặc suy đoán từ URL.</p><a className="ns-button ns-button--secondary" href="/admin/billing/invoices">Mở danh sách hóa đơn</a></Card></main>;

  const columns = config.kind === "plans" ? [{ key: "planCode", label: "Mã gói" }, { key: "planName", label: "Tên gói" }, { key: "billingInterval", label: "Chu kỳ" }, { key: "unitAmountMinor", label: "Giá", money: true }, { key: "currency", label: "Tiền tệ" }] : config.kind === "usage" ? [{ key: "meterCode", label: "Chỉ số" }, { key: "periodStart", label: "Từ ngày" }, { key: "periodEnd", label: "Đến ngày" }, { key: "quantity", label: "Đã dùng" }, { key: "quota", label: "Hạn mức" }] : config.kind === "methods" ? [{ key: "provider", label: "Nhà cung cấp" }, { key: "methodType", label: "Phương thức" }, { key: "displayJson", label: "Hiển thị đã che" }, { key: "status", label: "Trạng thái" }, { key: "createdAt", label: "Ngày thêm" }] : [{ key: "invoiceNumber", label: "Số hóa đơn" }, { key: "status", label: "Trạng thái" }, { key: "totalMinor", label: "Tổng tiền", money: true }, { key: "currency", label: "Tiền tệ" }, { key: "dueAt", label: "Hạn thanh toán" }];
  const canPay = permissions.includes("tenant.billing.manage") && (config.kind === "invoices" || config.kind === "invoice-detail");
  const displayRows = config.kind === "invoice-detail" ? rows.slice(0, 1) : rows;
  return <main className="shell ops-shell ns-billing-resource"><PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={config.title} description={config.description} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p className="success" role="status">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải dữ liệu thanh toán" detail="Đang đọc bằng chứng từ API thanh toán gói…" />}
    {state === "forbidden" && <BillingBoundary title="Không có quyền xem dữ liệu thanh toán" detail="Quyền tenant.billing.read và phạm vi salon được máy chủ kiểm tra. UI không hiển thị số 0 thay cho dữ liệu bị từ chối." />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Dữ liệu thanh toán có thể chưa phải mới nhất." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải dữ liệu thanh toán" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <Card className="ns-billing-resource-empty"><strong>{config.kind === "methods" ? "Chưa có phương thức thanh toán" : config.kind === "plans" ? "Chưa có gói dịch vụ được công bố" : "Chưa có bằng chứng thanh toán"}</strong><p>API không trả bản ghi trong phạm vi được cấp quyền. Màn hình không tạo dữ liệu mẫu.</p></Card>}
    {state === "ready" && <><section className="ns-billing-resource-kpis" aria-label="Tóm tắt dữ liệu"><article><span>Bản ghi</span><strong>{displayRows.length}</strong><small>Do máy chủ cung cấp</small></article><article><span>Đang hiệu lực</span><strong>{displayRows.filter((row) => /ACTIVE|PAID|PUBLISHED/i.test(String(billingValue(row, "status", "state") ?? ""))).length}</strong><small>Trạng thái hiện tại</small></article><article><span>Có mã hệ thống</span><strong>{displayRows.filter((row) => billingValue(row, "id")).length}</strong><small>Không hiển thị UUID đầy đủ</small></article></section><Card className="ns-billing-resource-table"><header><div><p className="eyebrow">BẰNG CHỨNG ĐÃ LƯU</p><h2>{config.title}</h2><p>{displayRows.length} bản ghi từ API trong phạm vi hiện tại.</p></div><span className="ns-billing-resource-scope">Tenant billing</span></header><div className="ns-billing-resource-table-wrap"><table><caption className="sr-only">{config.title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}{canPay && <th scope="col">Thao tác</th>}</tr></thead><tbody>{displayRows.map((row, index) => <tr key={String(billingValue(row, "id") ?? index)}>{columns.map((column) => <td key={column.key} data-label={column.label}>{column.money ? formatMinor(billingValue(row, column.key), String(billingValue(row, "currency") ?? "VND")) : resourceCell(row, column.key)}</td>)}{canPay && <td className="ns-billing-resource-actions"><Button variant="secondary" disabled={busy !== null || /PAID|CANCELLED|VOID/i.test(String(billingValue(row, "status", "state") ?? ""))} onClick={() => void pay(row)}>{busy === `pay:${row.id}` ? "Đang xử lý…" : "Tạo yêu cầu thanh toán"}</Button></td>}</tr>)}</tbody></table></div></Card>{config.kind === "methods" && <Card className="ns-billing-resource-safety"><strong>Thông tin phương thức đã được che</strong><p>Chỉ provider, loại phương thức và display_json an toàn được hiển thị. Không có trường nhập số thẻ hoặc thông tin xác thực trong màn hình này.</p></Card>}{config.kind === "invoices" && <Card className="ns-billing-resource-safety"><strong>Hóa đơn gói nền tảng</strong><p>Thanh toán gói dùng workflow server-authoritative; không đánh dấu đã thanh toán từ trình duyệt.</p></Card>}</>}
    {error && state === "ready" && <p className="error" role="alert">{error}</p>}
  </main>;
}

function SubscriptionWorkspace({ route }: { route: Wave6Route }) {
  const [state, setState] = useState<AsyncState>("loading");
  const [subscription, setSubscription] = useState<any>();
  const [plans, setPlans] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const intentKeys = useState(() => new Map<string, string>())[0];
  const load = useCallback(async () => {
    setState("loading"); setError("");
    const result = await Promise.allSettled([getAuthContext(), readApi("/v1/tenant/billing/subscription"), readApi("/v1/tenant/billing/plans")]);
    if (result[0].status === "fulfilled") setPermissions(result[0].value.supportAccess?.permissions ?? result[0].value.authorization?.permissions ?? []);
    const sub = result[1];
    if (sub.status === "rejected") { const cause: any = sub.reason; setError(cause?.message ?? "Không thể tải gói đăng ký."); setState(cause?.forbidden ? "forbidden" : "error"); return; }
    const value = rowsFrom(sub.value)[0];
    setSubscription(value);
    setPlans(result[2].status === "fulfilled" ? rowsFrom(result[2].value) : []);
    setState(value ? "ready" : "empty");
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function transition(action: "cancel" | "reactivate") {
    if (!subscription?.version) return;
    const key = `${action}:${subscription.id ?? "current"}`;
    let intentKey = intentKeys.get(key); if (!intentKey) { intentKey = crypto.randomUUID(); intentKeys.set(key, intentKey); }
    setBusy(key); setError(""); setNotice("");
    try { await commandApi(`/v1/tenant/billing/subscription/${action}`, { version: subscription.version, ...(action === "cancel" ? { reason: "Đã yêu cầu từ màn hình quản lý gói" } : {}) }, intentKey); setNotice("Máy chủ đã xác nhận thay đổi gói. Dữ liệu đang được tải lại."); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Không thể thay đổi trạng thái gói."); }
    finally { setBusy(null); }
  }
  const canManage = permissions.includes("tenant.billing.manage");
  const status = String(billingValue(subscription, "status", "state") ?? "UNKNOWN").toUpperCase();
  const canCancel = canManage && ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(status);
  const canReactivate = canManage && ["CANCEL_AT_PERIOD_END", "CANCELLED"].includes(status);
  return <main className="shell ops-shell ns-billing-subscription"><PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title="Quản lý gói dịch vụ" description="Vòng đời gói và quyền truy cập do máy chủ quyết định; mọi lệnh đều có version và idempotency." actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p className="success" role="status">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải gói đăng ký" detail="Đang đọc gói hiện tại và các gói đã công bố…" />}
    {state === "forbidden" && <BillingBoundary title="Không có quyền quản lý gói" detail="Gói đăng ký chỉ hiển thị theo quyền thanh toán của Tenant; không suy đoán trạng thái khi API từ chối." />}
    {state === "error" && <StatePanel state="error" title="Không thể tải gói đăng ký" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <Card className="ns-billing-resource-empty"><strong>Chưa có gói đăng ký</strong><p>Tenant chưa có subscription do máy chủ trả về; màn hình không tự tạo tài khoản hoặc gói.</p></Card>}
    {state === "ready" && <><section className="ns-billing-summary" aria-label="Tóm tắt gói"><article><span>Gói hiện tại</span><strong>{billingName(billingValue(subscription, "planName", "plan"), "Chưa có gói")}</strong><small>{billingValue(subscription, "planCode") ?? "Mã gói do máy chủ cung cấp"}</small></article><article><span>Trạng thái</span><strong><Status value={status} /></strong><small>State machine server-authoritative</small></article><article><span>Gia hạn</span><strong>{billingDate(billingValue(subscription, "currentPeriodEnd", "current_period_end"))}</strong><small>Ngày theo hợp đồng</small></article><article><span>Phiên bản</span><strong>{billingValue(subscription, "version") ?? "—"}</strong><small>Concurrency version</small></article></section><Card className="ns-billing-subscription-card"><header><div><p className="eyebrow">GÓI ĐANG ĐƯỢC ÁP DỤNG</p><h2>{billingName(billingValue(subscription, "planName", "plan"), "Chưa có gói đăng ký")}</h2><p>Hủy, kích hoạt lại hoặc đổi gói chỉ được gửi qua command API; UI không cập nhật lạc quan.</p></div><div className="ns-billing-subscription-actions">{canCancel && <Button variant="secondary" disabled={busy !== null} onClick={() => void transition("cancel")}>{busy?.startsWith("cancel:") ? "Đang xử lý…" : "Hủy gói"}</Button>}{canReactivate && <Button variant="primary" disabled={busy !== null} onClick={() => void transition("reactivate")}>{busy?.startsWith("reactivate:") ? "Đang xử lý…" : "Kích hoạt lại"}</Button>}</div></header><dl><div><dt>Trạng thái hiện tại</dt><dd><Status value={status} /></dd></div><div><dt>Gia hạn</dt><dd>{billingDate(billingValue(subscription, "currentPeriodEnd", "current_period_end"))}</dd></div><div><dt>Ngày bắt đầu</dt><dd>{billingDate(billingValue(subscription, "currentPeriodStart", "current_period_start"))}</dd></div><div><dt>Phiên bản</dt><dd>{billingValue(subscription, "version") ?? "—"}</dd></div></dl></Card>{canManage ? <ChangePlanForm subscription={subscription} options={plans} /> : <Card className="ns-billing-resource-safety"><strong>Quyền quản lý gói chưa được cấp</strong><p>Bạn vẫn có thể xem trạng thái server, nhưng không thể gửi lệnh đổi gói hoặc đổi trạng thái.</p></Card>}</>}
    {error && state === "ready" && <p className="error" role="alert">{error}</p>}
  </main>;
}

export default function TenantBillingWorkspace({ route }: { route: Wave6Route }) {
  const path = route.href;
  if (path === "/admin/billing") return <BillingOverview route={route} />;
  if (route.screenId === "19.6.13") return <SubscriptionWorkspace route={route} />;
  const config = billingResourceConfig(path);
  if (config) return <BillingResource route={route} config={config} />;
  return <BillingOverview route={route} />;
}
