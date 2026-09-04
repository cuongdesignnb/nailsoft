"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Icon as UiIcon } from "@nailsoft/ui-web";
import { ACTIVE_BRANCH_CHANGED_EVENT, authorizedFetch, getActiveBranchId, getAuthorizedBranchContext, setActiveBranchId } from "../auth";
import styles from "./net-sales-page.module.css";

type Branch = { id: string; name: string; code?: string; timezone?: string; status?: string };
type Staff = { id: string; displayName: string; employeeCode?: string | null };
type Service = { id: string; code: string; name?: Record<string, string> | string };
type Filters = { branchId: string; from: string; to: string; comparisonMode: "NONE" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "CUSTOM"; comparisonFrom: string; comparisonTo: string; staffId: string; serviceId: string; paymentMethod: string; view: "overview" | "daily" };
type Totals = { invoiceRevenueMinor: number; grossBeforeDiscountMinor: number; discountMinor: number; taxMinor: number; completedRefundMinor: number; netSalesMinor: number; tipMinor: number; paidOrderCount: number; creditNoteIssuedMinor: number; creditNoteIssuedCount: number };
type Overview = {
  filters: Record<string, unknown>;
  generatedAt: string;
  currency: string | null;
  timezone: string | null;
  formulaVersion: string;
  formulaDescription: string;
  totals: Totals;
  comparison: { currentNetSalesMinor: number; previousNetSalesMinor: number | null; changeMinor: number | null; changePercent: number | null; comparisonMode: string; comparisonState: string; previousFrom: string | null; previousTo: string | null };
  quality: { refundRate: number | null; discountRate: number | null; reconciledPaymentRate: number | null };
  alerts: Array<{ code: string; severity: string; message: string }>;
  daily: Array<{ businessDate: string; invoiceRevenueMinor: number; discountMinor: number; taxMinor: number; completedRefundMinor: number; netSalesMinor: number }>;
  services: Array<{ serviceId: string | null; serviceName: string; currency: string; performedCount: number; invoiceRevenueMinor: number; completedRefundMinor: number; netSalesMinor: number; comparisonPercent: number | null }>;
  staff: Array<{ staffId: string | null; staffName: string; currency: string; attributedServiceCount: number; attributedRevenueMinor: number; attributedRefundMinor: number; attributedNetSalesMinor: number; comparisonPercent: number | null }>;
  branches: Array<{ branchId: string; branchName: string; currency: string; invoiceRevenueMinor: number; completedRefundMinor: number; netSalesMinor: number; comparisonPercent: number | null }>;
  paymentMix: Array<{ tenderType: string; capturedMinor: number; paymentCount: number }>;
  sources: Record<string, string>;
};
type AuthContext = Awaited<ReturnType<typeof getAuthorizedBranchContext>>["context"];

const DEFAULT_FILTERS = (): Filters => {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const today = new Date();
  const to = params.get("to") ?? isoDate(today);
  const from = params.get("from") ?? isoDate(new Date(today.getTime() - 29 * 86_400_000));
  const comparisonMode = (params.get("comparisonMode") as Filters["comparisonMode"] | null) ?? "PREVIOUS_PERIOD";
  return { branchId: params.get("branchId") ?? getActiveBranchId() ?? "", from, to, comparisonMode, comparisonFrom: params.get("comparisonFrom") ?? "", comparisonTo: params.get("comparisonTo") ?? "", staffId: params.get("staffId") ?? "", serviceId: params.get("serviceId") ?? "", paymentMethod: params.get("paymentMethod") ?? "", view: params.get("view") === "daily" ? "daily" : "overview" };
};

function unwrap(body: unknown) {
  return typeof body === "object" && body !== null && "data" in body
    ? (body as { data?: unknown }).data
    : body;
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  const errorMessage = typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "message" in body.error && typeof body.error.message === "string" ? body.error.message : "Không thể tải dữ liệu doanh thu thuần.";
  if (!response.ok) throw new Error(errorMessage);
  return unwrap(body) as T;
}
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function money(value: number | null | undefined, currency = "VND") { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value ?? 0); }
function dateLabel(value?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
function percent(value: number | null | undefined) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`; }
function paymentLabel(value: string) { return ({ CASH: "Tiền mặt", BANK_TRANSFER: "Chuyển khoản", CARD_EXTERNAL: "Thẻ", OTHER_EXTERNAL: "Khác" } as Record<string, string>)[value] ?? value; }
function comparisonLabel(value: Filters["comparisonMode"]) { return ({ NONE: "Không so sánh", PREVIOUS_PERIOD: "Kỳ trước", PREVIOUS_YEAR: "Cùng kỳ năm trước", CUSTOM: "Kỳ tùy chọn" })[value]; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "Không thể tải dữ liệu doanh thu."; }

function Badge({ tone, children }: { tone: "green" | "amber" | "rose" | "blue" | "gray"; children: ReactNode }) {
  return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}>{children}</span>;
}
function Kpi({ icon, label, value, meta, tone = "rose" }: { icon: "wallet" | "tag" | "refresh" | "file" | "gift" | "trend"; label: string; value: string; meta: string; tone?: "rose" | "amber" | "coral" | "blue" | "purple" | "green" }) {
  return <article className={`${styles.kpi} ${styles[`kpi${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}><span className={styles.kpiIcon}><UiIcon name={icon} /></span><div><span className={styles.kpiLabel}>{label}</span><strong className={styles.kpiValue}>{value}</strong><span className={styles.kpiMeta}>{meta}</span></div></article>;
}
function Card({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return <section className={`${styles.card} ${className}`}><div className={styles.cardHeader}><h2>{title}</h2>{action}</div>{children}</section>;
}
function Empty({ children = "Chưa có dữ liệu đủ điều kiện trong khoảng thời gian này." }: { children?: ReactNode }) { return <div className={styles.empty}><UiIcon name="chart" /><strong>{children}</strong><span>Hãy thử đổi khoảng thời gian hoặc xóa bộ lọc.</span></div>; }

export default function NetSalesPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [context, setContext] = useState<AuthContext>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);

  const updateUrl = useCallback((next: Filters) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => { if (value && value !== "overview") params.set(key, value); });
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, []);
  const updateFilters = useCallback((changes: Partial<Filters>) => setFilters((current) => { const next = { ...current, ...changes }; updateUrl(next); return next; }), [updateUrl]);

  const loadOptions = useCallback(async (branchId: string) => {
    setOptionsLoading(true);
    const params = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
    try {
      const [staffRows, serviceResult] = await Promise.all([
        api<Staff[]>(`/v1/staff?status=ACTIVE${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`),
        api<{ items?: Service[] }>(`/v1/services?status=ACTIVE&page=1&pageSize=100${params ? `&branchId=${encodeURIComponent(branchId)}` : ""}`),
      ]);
      setStaff(staffRows ?? []);
      setServices(serviceResult?.items ?? (Array.isArray(serviceResult) ? serviceResult as unknown as Service[] : []));
    } catch { setStaff([]); setServices([]); } finally { setOptionsLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void getAuthorizedBranchContext().then((result) => {
      if (!active) return;
      setContext(result.context);
      setBranches(result.branches as Branch[]);
      const branchId = filters.branchId || result.branchId || "";
      if (branchId !== filters.branchId) updateFilters({ branchId });
      void loadOptions(branchId);
    }).catch((cause: unknown) => { if (active) setError(errorText(cause)); });
    const onBranchChange = () => { void getAuthorizedBranchContext().then((result) => { setContext(result.context); setBranches(result.branches as Branch[]); const branchId = result.branchId ?? ""; updateFilters({ branchId }); void loadOptions(branchId); }).catch(() => undefined); };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { active = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, [filters.branchId, loadOptions, updateFilters]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ from: filters.from, to: filters.to, comparisonMode: filters.comparisonMode, granularity: "DAY" });
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.comparisonFrom && filters.comparisonMode === "CUSTOM") params.set("comparisonFrom", filters.comparisonFrom);
    if (filters.comparisonTo && filters.comparisonMode === "CUSTOM") params.set("comparisonTo", filters.comparisonTo);
    if (filters.staffId) params.set("staffId", filters.staffId);
    if (filters.serviceId) params.set("serviceId", filters.serviceId);
    if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    setLoading(true); setError("");
    void api<Overview>(`/v1/financial/net-sales/overview?${params}`).then((value) => { if (active) setOverview(value); }).catch((cause: unknown) => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);

  const currency = overview?.currency ?? "VND";
  const totals = overview?.totals;
  const trendMax = Math.max(1, ...(overview?.daily ?? []).flatMap((row) => [row.invoiceRevenueMinor, row.netSalesMinor]));
  const hasData = Boolean(overview?.daily.length || totals?.invoiceRevenueMinor || totals?.completedRefundMinor);
  const permissionList = context?.supportAccess?.permissions ?? context?.authorization.permissions ?? [];
  const canExport = permissionList.includes("financial.export");

  async function exportReport() {
    setExporting(true); setError(""); setNotice("");
    try {
      const result = await api<{ id: string; status: string }>("/v1/financial/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ branchId: filters.branchId || undefined, exportType: "NET_SALES", filters: { from: filters.from, to: filters.to, comparisonMode: filters.comparisonMode, staffId: filters.staffId || undefined, serviceId: filters.serviceId || undefined } }) });
      setNotice(`Đã tạo yêu cầu xuất báo cáo (${result.status}). Theo dõi tiến trình tại khu vực Xuất báo cáo.`);
    } catch (cause: unknown) { setError(errorText(cause)); } finally { setExporting(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.breadcrumb}><span>Tài chính</span><b>/</b><strong>Doanh thu thuần</strong></div><h1>Doanh thu thuần</h1><p>Phân tích doanh thu thực nhận sau các khoản hoàn tiền và các yếu tố điều chỉnh để đánh giá chính xác hiệu quả kinh doanh.</p></div><div className={styles.headerActions}><label className={styles.headerDate}><UiIcon name="calendar" /><input aria-label="Ngày bắt đầu" type="date" value={filters.from} onChange={(event) => updateFilters({ from: event.target.value })} /><span>–</span><input aria-label="Ngày kết thúc" type="date" value={filters.to} onChange={(event) => updateFilters({ to: event.target.value })} /></label><button className={styles.button} onClick={() => updateFilters({ comparisonMode: filters.comparisonMode === "NONE" ? "PREVIOUS_PERIOD" : "NONE" })}><UiIcon name="trend" /> {filters.comparisonMode === "NONE" ? "So sánh kỳ trước" : comparisonLabel(filters.comparisonMode)}</button><button className={styles.button} disabled={!canExport || exporting} onClick={() => void exportReport()}><UiIcon name="download" /> {exporting ? "Đang tạo…" : "Xuất báo cáo"}</button><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => { updateFilters({ view: "daily" }); document.getElementById("net-sales-daily")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Xem chi tiết doanh thu</button></div></header>
    {error ? <div className={styles.alertError} role="alert"><UiIcon name="alert" /> {error}<button onClick={() => updateFilters({})}>Thử lại</button></div> : null}
    {notice ? <div className={styles.alertSuccess} role="status"><UiIcon name="check" /> {notice}<button onClick={() => setNotice("")}>Đóng</button></div> : null}
    <section className={styles.hero}><div className={styles.heroAmount}><span>Doanh thu thuần trong kỳ</span><strong>{loading ? "Đang tải…" : money(totals?.netSalesMinor, currency)}</strong><span className={overview?.comparison.changePercent != null ? (overview.comparison.changePercent >= 0 ? styles.trendUp : styles.trendDown) : styles.muted}>{overview?.comparison.changePercent != null ? `${overview.comparison.changePercent >= 0 ? "↑" : "↓"} ${percent(overview.comparison.changePercent)} so với ${comparisonLabel(filters.comparisonMode).toLowerCase()}` : "Chưa bật so sánh kỳ"}</span></div><div className={styles.heroFormula}><div><span>Doanh thu hóa đơn</span><strong>{money(totals?.invoiceRevenueMinor, currency)}</strong></div><i>−</i><div className={styles.refundValue}><span>Hoàn tiền đã hoàn tất</span><strong>{money(totals?.completedRefundMinor, currency)}</strong></div><i>=</i><div className={styles.netValue}><span>Doanh thu thuần</span><strong>{money(totals?.netSalesMinor, currency)}</strong></div></div><div className={styles.freshness}><span>Dữ liệu cập nhật</span><strong><i /> Đã đồng bộ</strong><small>{overview?.generatedAt ? `Cập nhật ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(overview.generatedAt))}` : "Đang tải dữ liệu"}</small></div></section>
    <section className={styles.kpis}><Kpi icon="wallet" label="Doanh thu hóa đơn" value={money(totals?.invoiceRevenueMinor, currency)} meta={`${totals?.paidOrderCount ?? 0} hóa đơn đủ điều kiện`} /><Kpi icon="tag" label="Giảm giá" value={money(totals?.discountMinor, currency)} meta={totals?.grossBeforeDiscountMinor ? `${percent((totals.discountMinor / totals.grossBeforeDiscountMinor) * 100)} trên giá trước giảm` : "Theo invoice line snapshot"} tone="amber" /><Kpi icon="refresh" label="Hoàn tiền" value={money(totals?.completedRefundMinor, currency)} meta="Chỉ refund đã COMPLETED" tone="coral" /><Kpi icon="file" label="Credit Note" value={money(totals?.creditNoteIssuedMinor, currency)} meta={`${totals?.creditNoteIssuedCount ?? 0} chứng từ đã phát hành · không trừ lần hai`} tone="blue" /><Kpi icon="gift" label="Tip" value={money(totals?.tipMinor, currency)} meta="Theo dõi riêng, không cộng Net Sales" tone="purple" /><Kpi icon="trend" label="Giá trị giao dịch TB" value={totals?.paidOrderCount ? money((totals.invoiceRevenueMinor / totals.paidOrderCount), currency) : "—"} meta="Doanh thu hóa đơn / số hóa đơn" tone="green" /></section>
    <section className={styles.filters}><div className={styles.filterRow}><label><span>Khoảng thời gian</span><div className={styles.inputWithIcon}><UiIcon name="calendar" /><input type="date" value={filters.from} onChange={(event) => updateFilters({ from: event.target.value })} /><span>–</span><input type="date" value={filters.to} onChange={(event) => updateFilters({ to: event.target.value })} /></div></label><label><span>Chi nhánh</span><select value={filters.branchId} onChange={(event) => { const value = event.target.value; setActiveBranchId(value || undefined); updateFilters({ branchId: value }); void loadOptions(value); }}><option value="">Tất cả chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label><span>Dịch vụ</span><select value={filters.serviceId} onChange={(event) => updateFilters({ serviceId: event.target.value })}><option value="">Tất cả dịch vụ đủ điều kiện</option>{services.map((service) => <option key={service.id} value={service.id}>{typeof service.name === "string" ? service.name : service.name?.["vi-VN"] ?? service.name?.["en-US"] ?? service.code}</option>)}</select></label><label><span>Nhân viên</span><select value={filters.staffId} onChange={(event) => updateFilters({ staffId: event.target.value })}><option value="">Tất cả</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><label><span>Phương thức thanh toán (mix)</span><select value={filters.paymentMethod} onChange={(event) => updateFilters({ paymentMethod: event.target.value })}><option value="">Tất cả</option><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CARD_EXTERNAL">Thẻ</option><option value="OTHER_EXTERNAL">Khác</option></select></label><label><span>So sánh với</span><select value={filters.comparisonMode} onChange={(event) => updateFilters({ comparisonMode: event.target.value as Filters["comparisonMode"] })}><option value="NONE">Không so sánh</option><option value="PREVIOUS_PERIOD">Kỳ trước</option><option value="PREVIOUS_YEAR">Cùng kỳ năm trước</option><option value="CUSTOM">Kỳ tùy chọn</option></select></label></div>{filters.comparisonMode === "CUSTOM" ? <div className={styles.customComparison}><label><span>Từ ngày so sánh</span><input type="date" value={filters.comparisonFrom} onChange={(event) => updateFilters({ comparisonFrom: event.target.value })} /></label><label><span>Đến ngày so sánh</span><input type="date" value={filters.comparisonTo} onChange={(event) => updateFilters({ comparisonTo: event.target.value })} /></label></div> : null}<div className={styles.viewTabs}><button className={filters.view === "overview" ? styles.activeTab : ""} onClick={() => updateFilters({ view: "overview" })}>Tổng quan</button><button className={filters.view === "daily" ? styles.activeTab : ""} onClick={() => { updateFilters({ view: "daily" }); document.getElementById("net-sales-daily")?.scrollIntoView({ behavior: "smooth" }); }}>Theo ngày</button><button className={styles.disabledTab} disabled>Theo dịch vụ <small>đang ở bảng dưới</small></button><button className={styles.disabledTab} disabled>Theo nhân viên <small>đang ở bảng dưới</small></button><button className={styles.disabledTab} disabled>Theo chi nhánh <small>đang ở bảng dưới</small></button></div></section>
    {loading && !overview ? <div className={styles.loadingState}><div /><div /><div /></div> : overview && hasData ? <>
      <section className={styles.dashboardGrid}><Card title="Xu hướng doanh thu" action={<span className={styles.legend}><i className={styles.legendInvoice} /> Doanh thu hóa đơn <i className={styles.legendNet} /> Doanh thu thuần</span>} className={styles.trendCard}><TrendChart rows={overview.daily} max={trendMax} currency={currency} /></Card><Card title="Từ doanh thu hóa đơn đến doanh thu thuần" className={styles.waterfallCard}><Waterfall totals={totals!} currency={currency} /></Card><Card title="Doanh thu theo nhóm" action={<Badge tone="blue">Theo kỳ hiện tại</Badge>} className={styles.branchCard}><Bars items={overview.branches.map((row) => ({ label: row.branchName, value: row.netSalesMinor, meta: percent(row.comparisonPercent) }))} currency={currency} /></Card></section>
      <section className={styles.dashboardGridBottom}><Card title="Dịch vụ tạo doanh thu cao nhất" action={<Link href="/admin/catalog/services">Xem dịch vụ →</Link>} className={styles.serviceCard}><ServiceTable items={overview.services.slice(0, 5)} currency={currency} /></Card><Card title="Doanh thu theo nhân viên" action={<Link href="/admin/financial/commission">Xem hoa hồng →</Link>} className={styles.staffCard}><StaffBars items={overview.staff.slice(0, 5)} currency={currency} /></Card><Card title="Theo phương thức thanh toán" action={<span className={styles.smallCaption}>Tiền đã thu · CAPTURED · không phân bổ Net Sales</span>} className={styles.paymentCard}><PaymentMix items={overview.paymentMix} currency={currency} /></Card></section>
      <section id="net-sales-daily" className={styles.lowerGrid}><Card title="Doanh thu theo ngày" action={<span className={styles.smallCaption}>{overview.daily.length} ngày có phát sinh</span>} className={styles.dailyCard}><DailyTable rows={overview.daily} currency={currency} /></Card><aside className={styles.sideStack}><Card title="Chất lượng số liệu"><div className={styles.qualityList}><KeyValue label="Tỷ lệ hoàn tiền" value={overview.quality.refundRate == null ? "—" : `${overview.quality.refundRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`} /><KeyValue label="Tỷ lệ giảm giá" value={overview.quality.discountRate == null ? "—" : `${overview.quality.discountRate.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`} /><KeyValue label="Đối soát payment" value="Chưa có chỉ số authoritative" /></div></Card><Card title="Công thức & nguồn dữ liệu"><div className={styles.formulaNote}><Badge tone="green">{overview.formulaVersion}</Badge><p>{overview.formulaDescription}</p><span>Discount và Tax được hiển thị để giải thích invoice line snapshot. Credit Note là chứng từ của Refund, không phải deduction bổ sung.</span></div></Card>{overview.alerts.length ? <Card title="Cần chú ý"><div className={styles.alertList}>{overview.alerts.map((alert) => <div key={alert.code}><UiIcon name="alert" /><span>{alert.message}</span></div>)}</div></Card> : null}</aside></section>
    </> : <section className={styles.card}><Empty /></section>}
    <footer className={styles.footer}><Link href="/admin/financial/commission" className={styles.button}><UiIcon name="arrowLeft" /> Hoa hồng / Điều chỉnh hoa hồng</Link><div><button className={styles.button} disabled={!canExport || exporting} onClick={() => void exportReport()}><UiIcon name="download" /> Xuất báo cáo</button><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => { updateFilters({ view: "daily" }); document.getElementById("net-sales-daily")?.scrollIntoView({ behavior: "smooth" }); }}>Xem chi tiết doanh thu</button></div></footer>
    {optionsLoading && overview ? <div className={styles.loadingBadge}>Đang cập nhật bộ lọc…</div> : null}
  </main>;
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) { return <div className={styles.keyValue}><span>{label}</span><strong>{value}</strong></div>; }
function TrendChart({ rows, max, currency }: { rows: Overview["daily"]; max: number; currency: string }) {
  if (!rows.length) return <Empty />;
  const width = 760; const height = 230; const pad = 28;
  const x = (index: number) => pad + index * ((width - pad * 2) / Math.max(1, rows.length - 1));
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const invoicePoints = rows.map((row, index) => `${x(index)},${y(row.invoiceRevenueMinor)}`).join(" ");
  const netPoints = rows.map((row, index) => `${x(index)},${y(row.netSalesMinor)}`).join(" ");
  return <div className={styles.chartWrap}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ doanh thu hóa đơn và doanh thu thuần theo ngày"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className={styles.axis} /><line x1={pad} y1={pad} x2={pad} y2={height - pad} className={styles.axis} /><polyline points={invoicePoints} className={styles.invoiceLine} /><polyline points={netPoints} className={styles.netLine} />{rows.map((row, index) => <g key={`${row.businessDate}-${index}`}><circle cx={x(index)} cy={y(row.netSalesMinor)} r="3.5" className={styles.netDot} /><title>{`${dateLabel(row.businessDate)} · Hóa đơn ${money(row.invoiceRevenueMinor, currency)} · Thuần ${money(row.netSalesMinor, currency)}`}</title></g>)}</svg><div className={styles.chartLabels}><span>{dateLabel(rows[0]?.businessDate)}</span><span>{dateLabel(rows[Math.floor(rows.length / 2)]?.businessDate)}</span><span>{dateLabel(rows[rows.length - 1]?.businessDate)}</span></div></div>;
}
function Waterfall({ totals, currency }: { totals: Totals; currency: string }) {
  const max = Math.max(1, totals.invoiceRevenueMinor); const items = [{ label: "Doanh thu hóa đơn", value: totals.invoiceRevenueMinor, tone: "invoice" }, { label: "Hoàn tiền đã hoàn tất", value: -totals.completedRefundMinor, tone: "refund" }, { label: "Doanh thu thuần", value: totals.netSalesMinor, tone: "net" }];
  return <div className={styles.waterfall}>{items.map((item) => <div className={styles.waterfallRow} key={item.label}><span>{item.label}</span><div><i className={styles[`waterfall${item.tone[0]!.toUpperCase()}${item.tone.slice(1)}`]} style={{ width: `${Math.max(8, Math.min(100, Math.abs(item.value) / max * 100))}%` }} /></div><strong className={item.value < 0 ? styles.negative : ""}>{item.value < 0 ? "−" : ""}{money(Math.abs(item.value), currency)}</strong></div>)}<div className={styles.breakdown}><span>Giảm giá đã phản ánh trong invoice line</span><strong>{money(totals.discountMinor, currency)}</strong><span>Thuế thành phần</span><strong>{money(totals.taxMinor, currency)}</strong><span>Credit Note · chứng từ, không trừ lần hai</span><strong>{money(totals.creditNoteIssuedMinor, currency)}</strong></div></div>;
}
function Bars({ items, currency }: { items: Array<{ label: string; value: number; meta: string | null }>; currency: string }) { const max = Math.max(1, ...items.map((item) => item.value)); return items.length ? <div className={styles.bars}>{items.map((item) => <div className={styles.barRow} key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(4, item.value / max * 100)}%` }} /></div><strong>{money(item.value, currency)}</strong><small>{item.meta ?? "—"}</small></div>)}</div> : <Empty />; }
function ServiceTable({ items, currency }: { items: Overview["services"]; currency: string }) { return items.length ? <div className={styles.miniTable}>{items.map((item) => <div className={styles.miniRow} key={item.serviceId ?? item.serviceName}><span><strong>{item.serviceName}</strong><small>{item.performedCount} lượt thực hiện</small></span><strong>{money(item.netSalesMinor, currency)}</strong><em className={item.comparisonPercent != null && item.comparisonPercent < 0 ? styles.negative : styles.positive}>{percent(item.comparisonPercent)}</em></div>)}</div> : <Empty />; }
function StaffBars({ items, currency }: { items: Overview["staff"]; currency: string }) { const max = Math.max(1, ...items.map((item) => item.attributedNetSalesMinor)); return items.length ? <div className={styles.bars}>{items.map((item) => <div className={styles.barRow} key={item.staffId ?? item.staffName}><span className={styles.staffName}><i>{item.staffName.split(" ").slice(-1)[0]?.[0] ?? "?"}</i>{item.staffName}</span><div><i className={styles.staffBar} style={{ width: `${Math.max(4, item.attributedNetSalesMinor / max * 100)}%` }} /></div><strong>{money(item.attributedNetSalesMinor, currency)}</strong><small>{percent(item.comparisonPercent)}</small></div>)}</div> : <Empty>Chưa có dữ liệu phân bổ nhân viên.</Empty>; }
function PaymentMix({ items, currency }: { items: Overview["paymentMix"]; currency: string }) { const total = items.reduce((sum, item) => sum + item.capturedMinor, 0); if (!items.length) return <Empty>Chưa có payment CAPTURED trong kỳ.</Empty>; let cursor = 0; const colors = ["#ed3f65", "#f5a623", "#6c9de8", "#a9a7b4"]; const segments = items.map((item, index) => { const start = cursor; cursor += item.capturedMinor / Math.max(1, total) * 360; return `${colors[index % colors.length]} ${start}deg ${cursor}deg`; }).join(", "); return <div className={styles.paymentMix}><div className={styles.donut} style={{ background: `conic-gradient(${segments})` } as CSSProperties}><span>{money(total, currency)}</span></div><div className={styles.paymentLegend}>{items.map((item, index) => <div key={item.tenderType}><i style={{ background: colors[index % colors.length] }} /><span>{paymentLabel(item.tenderType)}</span><strong>{total ? `${Math.round(item.capturedMinor / total * 100)}%` : "0%"}</strong><small>{money(item.capturedMinor, currency)}</small></div>)}</div></div>; }
function DailyTable({ rows, currency }: { rows: Overview["daily"]; currency: string }) { return rows.length ? <div className={styles.dailyTable}><div className={styles.dailyHead}><span>Ngày</span><span>Doanh thu hóa đơn</span><span>Hoàn tiền</span><span>Doanh thu thuần</span></div>{rows.map((row, index) => <div className={styles.dailyRow} key={`${row.businessDate}-${index}`}><strong>{dateLabel(row.businessDate)}</strong><span>{money(row.invoiceRevenueMinor, currency)}</span><span className={styles.negative}>{row.completedRefundMinor ? `−${money(row.completedRefundMinor, currency)}` : "—"}</span><strong>{money(row.netSalesMinor, currency)}</strong></div>)}</div> : <Empty />; }
