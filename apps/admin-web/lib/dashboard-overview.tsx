"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getAuthorizedBranchContext,
} from "./auth";

type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Remote = { state: LoadState; data?: any; error?: string };

const emptyRemote: Remote = { state: "empty" };

function localDate(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayName(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  for (const key of ["vi-VN", "vi", "en-US", "en", "name"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]);
  }
  return fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("vi-VN").format(numberValue(value));
}

function formatMinor(value: unknown, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(numberValue(value) / 100);
}

function formatTime(value: unknown, timeZone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(String(value)));
}

function formatShortDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date);
}

function unwrap(value: any) {
  return value?.data ?? value;
}

async function loadEndpoint(path: string | null): Promise<Remote> {
  if (!path) return emptyRemote;
  try {
    const response = await authorizedFetch(path);
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      return { state: "forbidden", error: body?.error?.message ?? "Bạn không có quyền truy cập dữ liệu này." };
    }
    if (!response.ok) {
      return { state: "error", error: body?.error?.message ?? "Không thể tải dữ liệu từ hệ thống." };
    }
    const data = unwrap(body);
    const isEmpty = Array.isArray(data) ? data.length === 0 : data == null;
    return { state: isEmpty ? "empty" : "ready", data };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : "Không thể kết nối đến hệ thống." };
  }
}

function StateMessage({ remote, label }: { remote: Remote; label: string }) {
  if (remote.state === "loading") return <div className="ns-dashboard-state"><span className="ns-dashboard-spinner" />Đang tải {label}…</div>;
  if (remote.state === "forbidden") return <div className="ns-dashboard-state ns-dashboard-state--warning"><strong>Không có quyền xem</strong><span>Phạm vi hiện tại không cho phép truy cập {label}.</span></div>;
  if (remote.state === "error") return <div className="ns-dashboard-state ns-dashboard-state--danger"><strong>Không thể tải {label}</strong><span>{remote.error ?? "Có lỗi xảy ra khi tải dữ liệu."}</span></div>;
  if (remote.state === "empty") return <div className="ns-dashboard-state"><strong>Chưa có dữ liệu</strong><span>Không có bản ghi phù hợp với khoảng thời gian đang chọn.</span></div>;
  return null;
}

function Panel({
  title,
  eyebrow,
  action,
  className = "",
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: { label: string; href: string };
  className?: string;
  children: ReactNode;
}) {
  return <section className={`ns-dashboard-panel ${className}`.trim()}>
    <div className="ns-dashboard-panel__head">
      <div>{eyebrow ? <p className="ns-dashboard-panel__eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </div>
    {children}
  </section>;
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone,
  trend,
}: {
  icon: "calendar" | "wallet" | "people" | "activity" | "check";
  label: string;
  value: string;
  detail: string;
  tone: string;
  trend?: string | null;
}) {
  return <article className={`ns-dashboard-kpi ns-dashboard-kpi--${tone}`}>
    <div className="ns-dashboard-kpi__top"><span className="ns-dashboard-kpi__icon"><Icon name={icon} /></span><span>{label}</span></div>
    <strong>{value}</strong>
    <small>{trend ? <span className="ns-dashboard-trend">↑ {trend}</span> : null}{detail}</small>
  </article>;
}

function RevenueChart({ remote, currency }: { remote: Remote; currency: string }) {
  const rows = useMemo(() => {
    const source = Array.isArray(remote.data?.trend) ? remote.data.trend : [];
    const grouped = source.reduce((result: Record<string, number>, row: any) => {
      const date = String(row.businessDate ?? row.date ?? "");
      if (date) result[date] = (result[date] ?? 0) + numberValue(row.netSalesMinor ?? row.grossSalesMinor);
      return result;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }, [remote.data]);
  const max = Math.max(1, ...rows.map((row) => numberValue(row.value)));
  const width = 620;
  const height = 230;
  const pad = { top: 18, right: 14, bottom: 34, left: 46 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const point = (value: number, index: number) => ({
    x: pad.left + (rows.length <= 1 ? innerWidth / 2 : (index / (rows.length - 1)) * innerWidth),
    y: pad.top + innerHeight - (value / max) * innerHeight,
  });
  const points = rows.map((row, index) => point(numberValue(row.value), index));
  const line = points.map((item, index) => `${index === 0 ? "M" : "L"}${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${points.at(-1)?.x.toFixed(1)},${height - pad.bottom} L${points[0]?.x.toFixed(1)},${height - pad.bottom} Z` : "";

  return <Panel title="Doanh thu 7 ngày gần nhất" action={{ label: "Xem phân tích", href: "/admin/analytics" }} className="ns-dashboard-chart-panel">
    <div className="ns-dashboard-chart-legend"><span />Doanh thu ({currency})</div>
    {remote.state !== "ready" ? <StateMessage remote={remote} label="biểu đồ doanh thu" /> : rows.length === 0 ? <StateMessage remote={{ state: "empty" }} label="biểu đồ doanh thu" /> : <>
      <div className="ns-dashboard-chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ doanh thu theo ngày">
          <defs><linearGradient id="ns-revenue-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f2556f" stopOpacity=".28" /><stop offset="1" stopColor="#f2556f" stopOpacity=".02" /></linearGradient></defs>
          {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad.left} x2={width - pad.right} y1={pad.top + innerHeight * ratio} y2={pad.top + innerHeight * ratio} className="ns-dashboard-chart-grid" />)}
          <path d={area} fill="url(#ns-revenue-fill)" />
          <path d={line} className="ns-dashboard-chart-line" />
          {points.map((item, index) => <circle key={`${rows[index]?.date ?? "point"}-${index}`} cx={item.x} cy={item.y} r="4.5" className="ns-dashboard-chart-point" />)}
          <text x="10" y={pad.top + 4}>MAX</text>
          <text x="20" y={height - pad.bottom + 4}>0</text>
        </svg>
        <div className="ns-dashboard-chart-labels">{rows.map((row, index) => <span key={`${row.date}-${index}`}>{formatShortDate(row.date)}</span>)}</div>
      </div>
      <div className="ns-dashboard-chart-table" aria-label="Bảng doanh thu theo ngày">{rows.map((row, index) => <div key={`${row.date}-${index}`}><span>{formatShortDate(row.date)}</span><strong>{formatMinor(row.value, currency)}</strong></div>)}</div>
    </>}
  </Panel>;
}

function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    CONFIRMED: "Đã xác nhận",
    CHECKED_IN: "Đã check-in",
    IN_SERVICE: "Đang phục vụ",
    COMPLETED: "Đã hoàn tất",
    READY_FOR_CHECKOUT: "Chờ thanh toán",
    PARTIALLY_COMPLETED: "Đang xử lý",
    UPCOMING: "Sắp tới",
    ARRIVED: "Đã đến",
    WAITING: "Đang chờ",
  };
  return labels[String(value)] ?? String(value ?? "Chưa xác định");
}

function AppointmentsPanel({ remote, timeZone }: { remote: Remote; timeZone: string }) {
  const rows = useMemo(() => {
    const columns = remote.data?.columns ?? {};
    return ["UPCOMING", "ARRIVED", "WAITING", "IN_SERVICE", "READY_FOR_CHECKOUT", "PARTIALLY_COMPLETED"]
      .flatMap((key) => Array.isArray(columns[key]) ? columns[key] : []).slice(0, 6);
  }, [remote.data]);
  return <Panel title="Lịch hẹn hôm nay" action={{ label: "Xem tất cả", href: "/admin/appointments" }} className="ns-dashboard-appointments-panel">
    {remote.state !== "ready" ? <StateMessage remote={remote} label="lịch hẹn" /> : rows.length === 0 ? <StateMessage remote={{ state: "empty" }} label="lịch hẹn" /> : <div className="ns-dashboard-table-wrap"><table className="ns-dashboard-table"><thead><tr><th>Giờ hẹn</th><th>Khách hàng</th><th>Dịch vụ</th><th>Kỹ thuật viên</th><th>Trạng thái</th></tr></thead><tbody>{rows.map((row: any) => {
      const items = Array.isArray(row.items) ? row.items : [];
      const service = items.map((item: any) => displayName(item.service, item.service?.code)).filter(Boolean).join(", ") || "—";
      const staff = items.some((item: any) => item.staffId) ? "Đã phân công" : "Chưa phân công";
      return <tr key={row.id}><td><strong>{formatTime(row.startAt, timeZone)}</strong></td><td>{row.customerDisplayName ?? "Khách hàng"}</td><td><span className="ns-dashboard-service-dot" />{service}</td><td>{staff}</td><td><span className={`ns-dashboard-status ns-dashboard-status--${String(row.status).toLowerCase().includes("service") ? "danger" : "success"}`}>{statusLabel(row.status)}</span></td></tr>;
    })}</tbody></table></div>}
  </Panel>;
}

function InventoryPanel({ stock, alerts }: { stock: Remote; alerts: Remote }) {
  const rows = useMemo(() => {
    const stockRows = Array.isArray(stock.data) ? stock.data : [];
    const openAlerts = Array.isArray(alerts.data) ? alerts.data.filter((row: any) => row.status === "OPEN") : [];
    const alertRows = openAlerts.map((alert: any) => {
      const current = stockRows.find((item: any) => item.itemId === alert.itemId);
      const details = alert.details ?? {};
      return { id: alert.id, name: displayName(current?.name ?? details.name ?? details.itemName, alert.itemId ? `Mã ${String(alert.itemId).slice(0, 8)}` : "Sản phẩm"), quantity: current?.available ?? details.availableQuantity ?? "—" };
    });
    if (alertRows.length) return alertRows.slice(0, 5);
    return stockRows.filter((row: any) => numberValue(row.available) <= 0).slice(0, 5).map((row: any) => ({ id: row.id, name: displayName(row.name, row.sku ?? "Sản phẩm"), quantity: row.available }));
  }, [alerts.data, stock.data]);
  const remote = alerts.state === "forbidden" && stock.state !== "ready" ? alerts : alerts.state === "ready" || stock.state === "ready" ? { state: rows.length ? "ready" : "empty" } as Remote : alerts;
  return <Panel title="Tồn kho cần chú ý" action={{ label: "Xem tất cả", href: "/admin/inventory" }} className="ns-dashboard-inventory-panel">
    {remote.state !== "ready" ? <StateMessage remote={remote} label="tồn kho" /> : rows.length === 0 ? <StateMessage remote={{ state: "empty" }} label="cảnh báo tồn kho" /> : <div className="ns-dashboard-stock-list">{rows.map((row) => <div key={row.id} className="ns-dashboard-stock-row"><span className="ns-dashboard-stock-thumb"><Icon name="inventory" /></span><span><strong>{row.name}</strong><small>Tồn khả dụng</small></span><b>{row.quantity}</b></div>)}</div>}
  </Panel>;
}

function PopularServicesPanel() {
  return <Panel title="Dịch vụ phổ biến" action={{ label: "Xem báo cáo", href: "/admin/analytics/sales" }} className="ns-dashboard-secondary-panel">
    <StateMessage remote={{ state: "empty" }} label="tổng hợp dịch vụ" />
    <p className="ns-dashboard-source-note">API analytics hiện chưa trả bảng phân bổ theo từng dịch vụ. Widget sẽ tự hiển thị khi projection dịch vụ được cung cấp.</p>
  </Panel>;
}

function StaffPerformancePanel() {
  return <Panel title="Hiệu suất nhân viên" action={{ label: "Xem tất cả", href: "/admin/analytics/staff" }} className="ns-dashboard-secondary-panel">
    <StateMessage remote={{ state: "empty" }} label="hiệu suất nhân viên" />
    <p className="ns-dashboard-source-note">Giữ trạng thái trống để tránh hiển thị doanh thu hoặc hoa hồng không có nguồn dữ liệu thật.</p>
  </Panel>;
}

function RetentionPanel({ remote }: { remote: Remote }) {
  const kpis = remote.data?.kpis ?? {};
  const active = numberValue(kpis.active_customers);
  const returning = numberValue(kpis.returning_customers);
  const rate = active > 0 ? Math.min(100, Math.round((returning / active) * 100)) : 0;
  return <Panel title="Khách hàng" action={{ label: "Xem báo cáo", href: "/admin/analytics" }} className="ns-dashboard-secondary-panel ns-dashboard-retention-panel">
    {remote.state !== "ready" || active === 0 ? <StateMessage remote={remote.state !== "ready" ? remote : { state: "empty" }} label="tỷ lệ khách quay lại" /> : <><div className="ns-dashboard-donut" style={{ "--donut-value": `${rate}%` } as CSSProperties}><div><strong>{rate}%</strong><span>Khách quay lại</span></div></div><div className="ns-dashboard-legend-list"><div><span className="ns-dashboard-legend-dot ns-dashboard-legend-dot--pink" /><span>Khách quay lại</span><b>{formatNumber(returning)}</b></div><div><span className="ns-dashboard-legend-dot ns-dashboard-legend-dot--gold" /><span>Khách đang hoạt động</span><b>{formatNumber(active)}</b></div></div></>}
  </Panel>;
}

function ActivityPanel({ remote }: { remote: Remote }) {
  const rows = Array.isArray(remote.data) ? remote.data.slice(0, 5) : [];
  return <Panel title="Hoạt động gần đây" action={{ label: "Xem tất cả", href: "/admin/communications" }} className="ns-dashboard-rail-panel">
    {remote.state !== "ready" ? <StateMessage remote={remote} label="hoạt động" /> : rows.length === 0 ? <StateMessage remote={{ state: "empty" }} label="hoạt động" /> : <div className="ns-dashboard-activity-list">{rows.map((row: any) => <div key={row.id}><span className="ns-dashboard-activity-dot"><Icon name="activity" /></span><span><strong>{row.title ?? row.type ?? "Hoạt động hệ thống"}</strong><small>{row.bodyRedacted ?? row.body ?? "Thông tin từ hệ thống"}</small></span><time>{row.createdAt ? formatTime(row.createdAt, "Asia/Ho_Chi_Minh") : "—"}</time></div>)}</div>}
  </Panel>;
}

function PosPanel({ remote, currency }: { remote: Remote; currency: string }) {
  const rows = Array.isArray(remote.data) ? remote.data.slice(0, 5) : [];
  return <Panel title="Giao dịch POS gần đây" action={{ label: "Xem tất cả", href: "/admin/pos" }} className="ns-dashboard-rail-panel">
    {remote.state !== "ready" ? <StateMessage remote={remote} label="giao dịch POS" /> : rows.length === 0 ? <StateMessage remote={{ state: "empty" }} label="giao dịch POS" /> : <div className="ns-dashboard-pos-list">{rows.map((row: any) => <div key={row.id}><span><strong>{row.orderNumber ?? row.id}</strong><small>{statusLabel(row.status)}</small></span><b>{formatMinor(row.grandTotalMinor ?? row.totalMinor, row.currency ?? currency)}</b><time>{row.createdAt ? formatTime(row.createdAt, "Asia/Ho_Chi_Minh") : "—"}</time></div>)}</div>}
  </Panel>;
}

export default function DashboardOverview() {
  const [from, setFrom] = useState(() => shiftDate(localDate("Asia/Ho_Chi_Minh"), -6));
  const [to, setTo] = useState(() => localDate("Asia/Ho_Chi_Minh"));
  const [branchId, setBranchId] = useState<string>();
  const [branchName, setBranchName] = useState("Tất cả chi nhánh");
  const [timeZone, setTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [currency, setCurrency] = useState("VND");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [resources, setResources] = useState({ analytics: emptyRemote, comparison: emptyRemote, board: emptyRemote, stock: emptyRemote, alerts: emptyRemote, pos: emptyRemote, activity: emptyRemote });

  const load = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const scope = await getAuthorizedBranchContext();
      const selected = scope.branchId ?? scope.branches[0]?.id;
      const branch = scope.branches.find((item) => item.id === selected);
      const zone = "Asia/Ho_Chi_Minh";
      setBranchId(selected);
      setBranchName(branch?.name ?? (scope.branches.length > 1 ? "Tất cả chi nhánh" : "Chi nhánh hiện tại"));
      setTimeZone(zone);
      setCurrency("VND");
      const query = new URLSearchParams({ from, to, comparisonMode: "PREVIOUS_PERIOD" });
      if (selected) query.set("branchId", selected);
      const boardQuery = selected ? `/v1/operations/board?branchId=${selected}&date=${to}` : null;
      const stockQuery = selected ? `/v1/inventory/stock?branchId=${selected}` : null;
      const alertQuery = selected ? `/v1/inventory/alerts?branchId=${selected}` : null;
      const posQuery = selected ? `/v1/pos-orders?branchId=${selected}` : "/v1/pos-orders";
      const [analytics, comparison, board, stock, alerts, pos, activity] = await Promise.all([
        loadEndpoint(`/v1/analytics/command-center?${query.toString()}`),
        loadEndpoint(`/v1/analytics/comparison?${query.toString()}`),
        loadEndpoint(boardQuery),
        loadEndpoint(stockQuery),
        loadEndpoint(alertQuery),
        loadEndpoint(posQuery),
        loadEndpoint("/v1/internal-notifications"),
      ]);
      const analyticsData = analytics.data;
      setCurrency(analyticsData?.metadata?.currency ?? "VND");
      setResources({ analytics, comparison, board, stock, alerts, pos, activity });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tải dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, refresh);
  }, [load]);

  const analytics = resources.analytics.data ?? {};
  const kpis = analytics.kpis ?? {};
  const comparison = resources.comparison.data?.netSales;
  const revenueTrend = comparison?.percentageChange == null ? null : `${Math.abs(numberValue(comparison.percentageChange))}% so với kỳ trước`;
  const occupancy = numberValue(kpis.eligible_working_minutes) > 0 ? `${Math.round((numberValue(kpis.booked_service_minutes) / numberValue(kpis.eligible_working_minutes)) * 100)}%` : "—";

  async function requestExport() {
    setNotice("");
    const response = await authorizedFetch("/v1/analytics/exports", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ exportType: "COMMAND_CENTER", filters: { from, to, branchIds: branchId ? [branchId] : [] } }),
    });
    setNotice(response.ok ? "Đã gửi yêu cầu xuất báo cáo." : "Không thể gửi yêu cầu xuất báo cáo với quyền hiện tại.");
  }

  return <main className="ns-dashboard-page">
    <div className="ns-dashboard-header">
      <div><p className="ns-dashboard-eyebrow">TỔNG QUAN</p><h1>Dashboard tổng quan</h1><p>Chào mừng bạn quay trở lại, chúc bạn một ngày làm việc hiệu quả!</p></div>
      <button className="ns-dashboard-export" onClick={() => void requestExport()}><Icon name="download" />Xuất báo cáo</button>
    </div>
    <div className="ns-dashboard-toolbar"><div className="ns-dashboard-scope"><Icon name="store" /><span><strong>{branchName}</strong><small>{timeZone}</small></span></div><label><span>Khoảng thời gian</span><select value={`${from}:${to}`} onChange={(event) => { const [nextFrom, nextTo] = event.target.value.split(":"); setFrom(nextFrom ?? from); setTo(nextTo ?? to); }}><option value={`${shiftDate(to, -6)}:${to}`}>7 ngày gần nhất</option><option value={`${shiftDate(to, -29)}:${to}`}>30 ngày gần nhất</option></select></label><button className="ns-dashboard-refresh" onClick={() => void load()} disabled={loading}><Icon name="refresh" />{loading ? "Đang tải…" : "Làm mới"}</button></div>
    {notice ? <p className="ns-dashboard-notice" role="status">{notice}</p> : null}
    {resources.analytics.state === "forbidden" || resources.analytics.state === "error" ? <div className="ns-dashboard-critical-state"><StateMessage remote={resources.analytics} label="dashboard" /></div> : null}
    <section className="ns-dashboard-kpi-grid" aria-label="Chỉ số tổng quan">
      <KpiCard icon="calendar" label="Lịch hẹn hôm nay" value={resources.board.state === "ready" ? formatNumber(Object.values(resources.board.data?.columns ?? {}).flat().length) : formatNumber(kpis.bookings_created)} detail="lịch từ dữ liệu hệ thống" tone="pink" />
      <KpiCard icon="wallet" label="Doanh thu trong kỳ" value={formatMinor(kpis.net_sales_minor, currency)} detail="doanh thu thuần" tone="coral" trend={revenueTrend} />
      <KpiCard icon="people" label="Khách hàng mới" value={formatNumber(kpis.new_customers)} detail="khách trong kỳ" tone="rose" />
      <KpiCard icon="activity" label="Tỷ lệ lấp đầy ghế" value={occupancy} detail={occupancy === "—" ? "chưa có capacity projection" : "theo thời gian làm việc"} tone="blush" />
      <KpiCard icon="check" label="Dịch vụ hoàn thành" value={formatNumber(kpis.completed_appointments)} detail="lịch đã hoàn tất" tone="red" />
    </section>
    <div className="ns-dashboard-grid">
      <RevenueChart remote={resources.analytics} currency={currency} />
      <AppointmentsPanel remote={resources.board} timeZone={timeZone} />
      <div className="ns-dashboard-side-rail"><InventoryPanel stock={resources.stock} alerts={resources.alerts} /><ActivityPanel remote={resources.activity} /><PosPanel remote={resources.pos} currency={currency} /></div>
      <PopularServicesPanel />
      <StaffPerformancePanel />
      <RetentionPanel remote={resources.analytics} />
    </div>
  </main>;
}
