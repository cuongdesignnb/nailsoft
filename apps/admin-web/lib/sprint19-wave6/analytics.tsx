"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartFallback, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { authorizedFetch } from "../auth";
import { commandApi, FreshnessBadge, MetricCards, Status, type AsyncState } from "./shared";
import type { Wave6Route } from "./routes";

export default function AnalyticsWorkspace({ route }: { route: Wave6Route }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<AsyncState>("loading"); const [data, setData] = useState<any>(null); const [error, setError] = useState("");
  const endpoint = useMemo(() => route.screenId === "19.6.30" ? `/v1/analytics/command-center?from=${from}&to=${to}&comparisonMode=PREVIOUS_PERIOD` : route.screenId === "19.6.31" ? `/v1/analytics/trends?from=${from}&to=${to}` : route.screenId === "19.6.32" ? `/v1/analytics/bookings?from=${from}&to=${to}` : route.screenId === "19.6.33" ? `/v1/analytics/staff?from=${from}&to=${to}` : "/v1/analytics/data-quality", [from, to, route.screenId]);
  const load = useCallback(async () => { setState("loading"); setError(""); try { const response = await authorizedFetch(endpoint); const body = await response.json().catch(() => ({})); if (response.status === 401 || response.status === 403) throw Object.assign(new Error(body.error?.message ?? "Permission denied for analytics scope."), { forbidden: true }); if (!response.ok) throw new Error(body.error?.message ?? "Unable to load analytics."); setData(body.data); setState("ready"); } catch (cause: any) { setError(cause.message); setState(cause.forbidden ? "forbidden" : (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error")); } }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const metadata = data?.metadata ?? {};
  const rows = Array.isArray(data?.trend) ? data.trend : Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const kpis = data?.kpis ?? data?.totals ?? {};
  const isQuality = route.screenId === "19.6.34";
  return <main className="shell ops-shell"><PageHeader eyebrow={`SPRINT 19 · WAVE 6 · ${route.screenId}`} title={route.title} description={route.description} actions={<button className="ns-button ns-button--secondary" onClick={() => void load()}>Refresh</button>} />
    <nav className="topbar" aria-label="Analytics navigation"><a href="/admin/analytics">Command center</a><a href="/admin/analytics/sales">Sales</a><a href="/admin/analytics/bookings">Bookings</a><a href="/admin/analytics/staff">Staff</a><a href="/admin/analytics/data-quality">Data quality</a></nav>
    <Card className="ns-filter-card"><div className="filters"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="ns-button ns-button--primary" onClick={() => void load()}>Apply</button></div></Card>
    {state === "loading" && <StatePanel state="loading" title="Loading projection" detail="Metrics are read from the server projection and include freshness evidence." />}
    {state === "forbidden" && <StatePanel state="forbidden" title="Permission denied" detail={error} onRetry={() => void load()} />}
    {state === "offline" && <StatePanel state="offline" title="Analytics unavailable offline" detail="Refresh when connected; analytics commands are never queued offline." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Unable to load analytics" detail={error} onRetry={() => void load()} />}
    {state === "ready" && <>
      {isQuality ? <QualityPanel data={data} /> : <>
        <MetricCards values={Object.entries(kpis).slice(0, 8).map(([label, value]) => ({ label: label.replaceAll("_", " "), value, money: /minor|amount|sales|payment|refund|tip/i.test(label) }))} />
        <Card><div className="title-row"><h2>Freshness</h2><FreshnessBadge value={metadata.freshnessStatus ?? metadata.status ?? "FRESH"} /></div><p>As of {metadata.asOf ?? "—"} · timezone {metadata.timezone ?? "—"} · currency {metadata.currency ?? "—"} · projection revision {metadata.projectionRevision ?? metadata.metricVersion ?? "—"}</p></Card>
        {rows.length ? <ChartFallback title="Server projection trend" description="The table is the accessible source of truth for this chart." rows={rows.slice(0, 12).map((row: any) => ({ label: String(row.businessDate ?? row.date ?? row.periodStart ?? row.branchName ?? row.branchId), value: String(row.netSalesMinor ?? row.grossSalesMinor ?? row.completedAppointments ?? row.value ?? "—") }))} /> : <StatePanel state="empty" title="No metrics in this range" detail="Adjust the date range or refresh the projection." onRetry={() => void load()} />}
      </>}
    </>}
  </main>;
}

function QualityPanel({ data }: { data: any }) {
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints : []; const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  return <><Card><div className="title-row"><h2>Projection health</h2><Status value={data?.metadata?.status ?? "FRESH"} /></div><p>Data-quality state is explicit; stale or rebuilding projections are not hidden.</p><table><thead><tr><th>Projector</th><th>Status</th><th>Revision</th><th>Last refresh</th></tr></thead><tbody>{checkpoints.map((row: any, index: number) => <tr key={row.id ?? row.projectorName ?? index}><td>{row.projectorName ?? row.projector_name}</td><td><Status value={row.status} /></td><td>{row.projectionRevision ?? row.projection_revision ?? "—"}</td><td>{row.lastSuccessfulRefreshAt ?? row.last_successful_refresh_at ?? "—"}</td></tr>)}</tbody></table></Card><Card><h2>Alerts</h2>{alerts.length ? <ul>{alerts.map((alert: any) => <li key={alert.id}><Status value={alert.state} /> {alert.title ?? alert.metricKey ?? "Analytics alert"}</li>)}</ul> : <p>No open alerts.</p>}<div className="ns-action-row"><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/projection/refresh", {})}>Request refresh</button><button className="ns-button ns-button--secondary" onClick={() => void commandApi("/v1/analytics/exports", { exportType: "COMMAND_CENTER" })}>Request export</button></div></Card></>;
}
