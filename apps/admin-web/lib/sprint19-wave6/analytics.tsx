"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartFallback, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import { commandApi, formatMinor, FreshnessBadge, MetricCards, Status, type AsyncState } from "./shared";
import type { Wave6Route } from "./routes";

const copy: Record<string, { title: string; description: string }> = {
  "19.6.30": { title: "Analytics command center", description: "Server-backed KPIs, trends, branch scope and freshness evidence." },
  "19.6.31": { title: "Sales analytics", description: "Read server-generated sales and service performance." },
  "19.6.32": { title: "Booking analytics", description: "Review business-date booking and utilization metrics." },
  "19.6.33": { title: "Staff analytics", description: "View permission-scoped workforce analytics." },
  "19.6.34": { title: "Data quality, alerts & exports", description: "Inspect projection health, alerts, exports and rebuild evidence." },
};

const metricLabels: Record<string, string> = {
  revenue: "Doanh thu",
  gross_sales: "Doanh thu gộp",
  gross_sales_minor: "Doanh thu gộp",
  net_sales: "Doanh thu ròng",
  net_sales_minor: "Doanh thu ròng",
  discount_minor: "Giảm giá",
  tax_collected_minor: "Thuế đã thu",
  payments_collected_minor: "Thanh toán đã thu",
  refunds_minor: "Hoàn tiền",
  tips_minor: "Tiền tip",
  netSalesMinor: "Doanh thu ròng",
  grossSalesMinor: "Doanh thu gộp",
  completedAppointments: "Lịch hẹn hoàn tất",
  bookings_created: "Lịch hẹn đã tạo",
  appointments: "Lịch hẹn",
  bookings: "Lịch hẹn",
  payments: "Thanh toán",
  refunds: "Hoàn tiền",
  tips: "Tiền tip",
  customers: "Khách hàng",
  utilization: "Công suất",
  bookings_confirmed: "Lịch hẹn đã xác nhận",
  completed_appointments: "Lịch hẹn hoàn tất",
  cancelled_appointments: "Lịch hẹn đã hủy",
  no_show_appointments: "Lịch hẹn khách không đến",
  walk_ins: "Khách vãng lai",
  booked_service_minutes: "Phút dịch vụ đã đặt",
  completed_service_minutes: "Phút dịch vụ hoàn tất",
  eligible_working_minutes: "Phút làm việc đủ điều kiện",
  new_customers: "Khách hàng mới",
  returning_customers: "Khách hàng quay lại",
};

function labelForMetric(key: string) {
  return metricLabels[key] ?? key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

function metricValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return String(object.value ?? object.total ?? object.count ?? object.amount ?? "Đã có dữ liệu");
  }
  return String(value);
}

function isMoneyMetric(key: string) {
  return /minor|amount|sales|payment|refund|tip|revenue/i.test(key);
}

function displayMetric(key: string, value: unknown, currency: string) {
  const normalized = metricValue(value);
  return isMoneyMetric(key) ? formatMinor(normalized, currency) : normalized;
}

function businessDateLabel(value: unknown, timeZone: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

export default function AnalyticsWorkspace({ route }: { route: Wave6Route }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<AsyncState>("loading");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const endpoint = useMemo(() => route.screenId === "19.6.30" ? `/v1/analytics/command-center?from=${from}&to=${to}&comparisonMode=PREVIOUS_PERIOD` : route.screenId === "19.6.31" ? `/v1/analytics/trends?from=${from}&to=${to}` : route.screenId === "19.6.32" ? `/v1/analytics/bookings?from=${from}&to=${to}` : route.screenId === "19.6.33" ? `/v1/analytics/staff?from=${from}&to=${to}` : "/v1/analytics/data-quality", [from, to, route.screenId]);
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      const response = await authorizedFetch(endpoint);
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error(body.error?.message ?? "Bạn không có quyền xem phạm vi phân tích này."), { forbidden: true });
      if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu phân tích.");
      setData(body.data); setState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu phân tích.");
      setState(cause?.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"));
    }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  const metadata = data?.metadata ?? {};
  const rows = Array.isArray(data?.trend) ? data.trend : Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const kpis = data?.kpis ?? data?.totals ?? {};
  const isQuality = route.screenId === "19.6.34";
  const page = copy[route.screenId] ?? { title: route.title, description: route.description };
  const currency = String(metadata.currency ?? "VND");
  const branches = Array.isArray(data?.branches) ? data.branches : [];
  const branchNames = new Map(branches.map((branch: any) => [String(branch.branchId ?? branch.id), String(branch.branchName ?? branch.name ?? branch.branchId ?? "Chi nhánh")]));
  const kpiEntries = Object.entries(kpis);
  const trendRows = rows.slice(0, 12).map((row: any, index: number) => {
    const branchName = branchNames.get(String(row.branchId)) ?? String(row.branchName ?? row.branchId ?? "Toàn phạm vi");
    return { label: `${businessDateLabel(row.businessDate ?? row.date ?? row.periodStart, String(metadata.timezone ?? "Asia/Ho_Chi_Minh"))} · ${branchName} · ${index + 1}`, value: displayMetric("netSalesMinor", row.netSalesMinor ?? row.grossSalesMinor ?? row.completedAppointments ?? row.value, currency) };
  });

  return <main className="ns-analytics-workspace"><PageHeader eyebrow="BÁO CÁO &amp; PHÂN TÍCH" title={page.title} description={page.description} actions={<button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button>} />
    <Card className="ns-filter-card"><div className="filters"><label> Từ ngày<input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Đến ngày<input aria-label="Đến ngày" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="ns-button ns-button--primary" onClick={() => void load()}>Áp dụng</button></div></Card>
    {state === "loading" && <StatePanel state="loading" title="Đang tải dữ liệu phân tích" detail="Số liệu được đọc từ projection máy chủ và kèm thông tin độ mới." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail={error} onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Kết nối lại để tải số liệu mới; thao tác phân tích không được xếp hàng ngoại tuyến." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải dữ liệu phân tích" detail={error} onRetry={() => void load()} />}
    {state === "ready" && <>{isQuality ? <QualityPanel data={data} /> : <><MetricCards currency={currency} values={kpiEntries.slice(0, 8).map(([key, value]) => ({ label: labelForMetric(key), value: metricValue(value), money: isMoneyMetric(key) }))} /><Card><div className="title-row"><div><p className="ns-eyebrow">ĐỘ MỚI DỮ LIỆU</p><h2>Freshness</h2></div><FreshnessBadge value={metadata.freshnessStatus ?? metadata.status ?? "FRESH"} /></div><p>Thời điểm dữ liệu: {metadata.asOf ?? "—"} · Múi giờ: {metadata.timezone ?? "—"} · Tiền tệ: {currency} · Phiên bản: {metadata.projectionRevision ?? metadata.metricVersion ?? "—"}</p><div className="ns-analytics-meta"><span>Độ trễ: {metadata.lagSeconds == null ? "—" : `${metadata.lagSeconds}s`}</span><span>Phạm vi: {metadata.filters?.granularity ?? "—"}</span><span>So sánh: {metadata.filters?.comparisonMode ?? "—"}</span></div></Card>{rows.length ? <ChartFallback title="Xu hướng theo kỳ" description="Bảng dữ liệu là nguồn truy xuất dễ tiếp cận của biểu đồ này." rows={trendRows} /> : <StatePanel state="empty" title="Chưa có số liệu trong khoảng này" detail="Hãy điều chỉnh khoảng ngày hoặc làm mới projection." onRetry={() => void load()} />}<section className="ns-analytics-grid"><BranchPerformance branches={branches} currency={currency} /><OperationalMetrics entries={kpiEntries.slice(8)} currency={currency} /></section><section className="ns-analytics-grid ns-analytics-grid--secondary"><ScopeCard metadata={metadata} /><AlertsCard alerts={Array.isArray(data?.alerts) ? data.alerts : []} /></section></>}</>}
  </main>;
}

function BranchPerformance({ branches, currency }: { branches: any[]; currency: string }) {
  return <Card className="ns-analytics-detail-card"><div className="title-row"><div><p className="ns-eyebrow">PHÂN BỔ PHẠM VI</p><h2>Hiệu suất theo chi nhánh</h2></div><span className="ns-chip">{branches.length}</span></div>{branches.length ? <div className="ns-table-scroll" tabIndex={0} aria-label="Bảng hiệu suất theo chi nhánh, có thể cuộn ngang"><table><caption className="sr-only">Hiệu suất theo chi nhánh</caption><thead><tr><th scope="col">Chi nhánh</th><th scope="col">Doanh thu ròng</th><th scope="col">Lịch hẹn hoàn tất</th></tr></thead><tbody>{branches.map((branch: any, index) => <tr key={`${branch.branchId ?? branch.id ?? "branch"}-${index}`}><th scope="row">{branch.branchName ?? branch.name ?? branch.branchId ?? "—"}</th><td>{formatMinor(branch.netSalesMinor, currency)}</td><td>{branch.completedAppointments ?? "—"}</td></tr>)}</tbody></table></div> : <p>Chưa có phân bổ chi nhánh trong khoảng đã chọn.</p>}</Card>;
}

function OperationalMetrics({ entries, currency }: { entries: Array<[string, unknown]>; currency: string }) {
  return <Card className="ns-analytics-detail-card"><div className="title-row"><div><p className="ns-eyebrow">CHỈ SỐ VẬN HÀNH</p><h2>Hoạt động &amp; công suất</h2></div><span className="ns-chip">{entries.length}</span></div>{entries.length ? <dl className="ns-analytics-metric-list">{entries.map(([key, value], index) => <div key={`${key}-${index}`}><dt>{labelForMetric(key)}</dt><dd>{displayMetric(key, value, currency)}</dd></div>)}</dl> : <p>Projection chưa trả về chỉ số vận hành bổ sung.</p>}</Card>;
}

function ScopeCard({ metadata }: { metadata: any }) {
  const filters = metadata?.filters ?? {};
  return <Card className="ns-analytics-detail-card"><div className="title-row"><div><p className="ns-eyebrow">NGỮ CẢNH DỮ LIỆU</p><h2>Phạm vi báo cáo</h2></div><FreshnessBadge value={metadata?.freshnessStatus ?? metadata?.status ?? "FRESH"} /></div><dl className="ns-analytics-definition-list"><div><dt>Từ ngày</dt><dd>{filters.from ?? "—"}</dd></div><div><dt>Đến ngày</dt><dd>{filters.to ?? "—"}</dd></div><div><dt>Độ chi tiết</dt><dd>{filters.granularity ?? "—"}</dd></div><div><dt>Chi nhánh</dt><dd>{Array.isArray(filters.branchIds) && filters.branchIds.length ? `${filters.branchIds.length} chi nhánh` : "Toàn phạm vi được cấp quyền"}</dd></div></dl></Card>;
}

function AlertsCard({ alerts }: { alerts: any[] }) {
  return <Card className="ns-analytics-detail-card"><div className="title-row"><div><p className="ns-eyebrow">KIỂM SOÁT</p><h2>Cảnh báo đang mở</h2></div><span className="ns-chip">{alerts.length}</span></div>{alerts.length ? <ul className="ns-analytics-alert-list">{alerts.map((alert: any, index) => <li key={`${alert.id ?? alert.metricKey ?? "alert"}-${index}`}><Status value={alert.state} /><span>{alert.title ?? alert.metricKey ?? "Cảnh báo phân tích"}</span></li>)}</ul> : <p>Không có cảnh báo đang mở trong response hiện tại.</p>}</Card>;
}

function QualityPanel({ data }: { data: any }) {
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  return <><Card><div className="title-row"><div><p className="ns-eyebrow">KIỂM TRA HỆ THỐNG</p><h2>Projection health</h2></div><Status value={data?.metadata?.status ?? "FRESH"} /></div><p>Trạng thái stale hoặc rebuilding được hiển thị rõ, không ẩn sau số liệu cũ.</p><table><caption className="sr-only">Trạng thái projection</caption><thead><tr><th scope="col">Projection</th><th scope="col">Trạng thái</th><th scope="col">Phiên bản</th><th scope="col">Làm mới gần nhất</th></tr></thead><tbody>{checkpoints.map((row: any, index: number) => <tr key={`${row.id ?? row.projectorName ?? "projection"}-${index}`}><td>{row.projectorName ?? row.projector_name ?? "—"}</td><td><Status value={row.status} /></td><td>{row.projectionRevision ?? row.projection_revision ?? "—"}</td><td>{row.lastSuccessfulRefreshAt ?? row.last_successful_refresh_at ?? "—"}</td></tr>)}</tbody></table></Card><Card><div className="title-row"><div><p className="ns-eyebrow">CẢNH BÁO</p><h2>Cảnh báo đang mở</h2></div><span className="ns-chip">{alerts.length}</span></div>{alerts.length ? <ul>{alerts.map((alert: any, index: number) => <li key={`${alert.id ?? alert.metricKey ?? "alert"}-${index}`}><Status value={alert.state} /> {alert.title ?? alert.metricKey ?? "Cảnh báo phân tích"}</li>)}</ul> : <p>Không có cảnh báo đang mở.</p>}<div className="ns-action-row"><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/projection/refresh", {})}>Yêu cầu làm mới</button><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/exports", { exportType: "COMMAND_CENTER" })}>Yêu cầu xuất báo cáo</button></div></Card></>;
}
