"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartFallback, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import { commandApi, FreshnessBadge, MetricCards, Status, wave6Error, wave6Text, wave6Title, type AsyncState } from "./shared";
import type { Wave6Route } from "./routes";

export default function AnalyticsWorkspace({ route }: { route: Wave6Route }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<AsyncState>("loading"); const [data, setData] = useState<any>(null); const [error, setError] = useState("");
  const endpoint = useMemo(() => route.screenId === "19.6.30" ? `/v1/analytics/command-center?from=${from}&to=${to}&comparisonMode=PREVIOUS_PERIOD` : route.screenId === "19.6.31" ? `/v1/analytics/trends?from=${from}&to=${to}` : route.screenId === "19.6.32" ? `/v1/analytics/bookings?from=${from}&to=${to}` : route.screenId === "19.6.33" ? `/v1/analytics/staff?from=${from}&to=${to}` : "/v1/analytics/data-quality", [from, to, route.screenId]);
  const load = useCallback(async () => { setState("loading"); setError(""); try { const response = await authorizedFetch(endpoint); const body = await response.json().catch(() => ({})); if (response.status === 401 || response.status === 403) throw Object.assign(new Error(body.error?.message ?? "Bạn không có quyền xem phạm vi phân tích này."), { forbidden: true }); if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu phân tích."); setData(body.data); setState("ready"); } catch (cause: any) { setError(cause.message); setState(cause.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")); } }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const metadata = data?.metadata ?? {};
  const rows = Array.isArray(data?.trend) ? data.trend : Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const kpis = data?.kpis ?? data?.totals ?? {};
  const isQuality = route.screenId === "19.6.34";
  const formatTimestamp = (value: unknown) => value && !Number.isNaN(Date.parse(String(value))) ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : String(value ?? "—");
  return <main className="shell ops-shell"><PageHeader eyebrow="NailSoft · PHÂN TÍCH" title={wave6Title(route.title)} description={wave6Text(route.description)} actions={<button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button>} />
    <nav className="topbar" aria-label="Điều hướng phân tích"><a href="/admin/analytics">Trung tâm</a><a href="/admin/analytics/sales">Doanh thu</a><a href="/admin/analytics/bookings">Lịch hẹn</a><a href="/admin/analytics/staff">Nhân sự</a><a href="/admin/analytics/data-quality">Chất lượng dữ liệu</a></nav>
    <Card className="ns-filter-card"><div className="filters"><label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="ns-button ns-button--primary" onClick={() => void load()}>Áp dụng</button></div></Card>
    {state === "loading" && <StatePanel state="loading" title="Đang tải dữ liệu phân tích" detail="Chỉ số được đọc từ projection trên máy chủ và có bằng chứng về độ mới." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Không có quyền truy cập" detail={wave6Error(error)} onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Phân tích không khả dụng khi ngoại tuyến" detail="Kết nối lại để làm mới; thao tác phân tích không được xếp hàng ngoại tuyến." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải phân tích" detail={wave6Error(error)} onRetry={() => void load()} />}
    {state === "ready" && <>
      {isQuality ? <QualityPanel data={data} /> : <>
        <MetricCards values={Object.entries(kpis).slice(0, 8).map(([label, value]) => ({ label: label.replaceAll("_", " "), value, money: /minor|amount|sales|payment|refund|tip/i.test(label) }))} />
        <Card><div className="title-row"><h2>Độ mới dữ liệu</h2><FreshnessBadge value={metadata.freshnessStatus ?? metadata.status ?? "FRESH"} /></div><p>Cập nhật lúc {formatTimestamp(metadata.asOf)} · múi giờ {metadata.timezone ?? "—"} · tiền tệ {metadata.currency ?? "—"} · phiên bản projection {metadata.projectionRevision ?? metadata.metricVersion ?? "—"}</p></Card>
        {rows.length ? <ChartFallback title="Xu hướng theo projection máy chủ" description="Bảng dữ liệu là nguồn sự thật có thể truy cập cho biểu đồ này." rows={rows.slice(0, 12).map((row: any) => ({ label: String(row.businessDate ?? row.date ?? row.periodStart ?? row.branchName ?? "Chi nhánh"), value: String(row.netSalesMinor ?? row.grossSalesMinor ?? row.completedAppointments ?? row.value ?? "—") }))} /> : <StatePanel state="empty" title="Chưa có chỉ số trong khoảng này" detail="Điều chỉnh khoảng ngày hoặc làm mới projection." onRetry={() => void load()} />}
      </>}
    </>}
  </main>;
}

function QualityPanel({ data }: { data: any }) {
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints : []; const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  return <><Card><div className="title-row"><h2>Sức khỏe projection</h2><Status value={data?.metadata?.status ?? "FRESH"} /></div><p>Trạng thái chất lượng dữ liệu được hiển thị rõ; projection cũ hoặc đang xây dựng lại không bị che đi.</p><table><thead><tr><th>Projection</th><th>Trạng thái</th><th>Phiên bản</th><th>Làm mới gần nhất</th></tr></thead><tbody>{checkpoints.map((row: any, index: number) => <tr key={row.id ?? row.projectorName ?? index}><td>{row.projectorName ?? row.projector_name}</td><td><Status value={row.status} /></td><td>{row.projectionRevision ?? row.projection_revision ?? "—"}</td><td>{row.lastSuccessfulRefreshAt ?? row.last_successful_refresh_at ?? "—"}</td></tr>)}</tbody></table></Card><Card><h2>Cảnh báo</h2>{alerts.length ? <ul>{alerts.map((alert: any) => <li key={alert.id}><Status value={alert.state} /> {alert.title ?? alert.metricKey ?? "Cảnh báo phân tích"}</li>)}</ul> : <p>Không có cảnh báo đang mở.</p>}<div className="ns-action-row"><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/projection/refresh", {})}>Yêu cầu làm mới</button><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/exports", { exportType: "COMMAND_CENTER" })}>Yêu cầu xuất báo cáo</button></div></Card></>;
}
