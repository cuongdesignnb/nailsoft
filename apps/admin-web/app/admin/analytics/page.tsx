"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "../../../lib/auth";

type State = "loading" | "ready" | "empty" | "forbidden" | "error";
export default function AnalyticsCommandCenter() {
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await authorizedFetch(`/v1/analytics/command-center?from=${from}&to=${to}&comparisonMode=PREVIOUS_PERIOD`);
      if (response.status === 403) { setState("forbidden"); return; }
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Unable to load analytics");
      setData(body.data); setState(body.data?.trend?.length ? "ready" : "empty");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load analytics"); setState("error"); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  const kpis = data?.kpis ?? {};
  return <main className="shell ops-shell" aria-busy={state === "loading"}>
    <nav className="topbar"><a href="/admin/analytics">Command Center</a><a href="/admin/analytics/sales">Sales</a><a href="/admin/analytics/bookings">Bookings</a><a href="/admin/analytics/staff">Staff</a><a href="/admin/analytics/data-quality">Data quality</a></nav>
    <section className="card"><p className="eyebrow">SPRINT 17 · OWNER COMMAND CENTER</p><div className="title-row"><div><h1>Business overview</h1><p>PostgreSQL-derived metrics with source revision, timezone and freshness evidence.</p></div><button onClick={() => void load()}>Refresh</button></div>
      <div className="filters"><label>From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button onClick={() => void load()}>Apply</button></div>
      {state === "loading" && <p aria-live="polite">Loading analytics…</p>}
      {state === "forbidden" && <p role="alert">Permission denied for analytics scope.</p>}
      {state === "error" && <div role="alert"><p>{message}</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "empty" && <div><p>No source data in this range.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "ready" && <>
        <div className="metric-grid">{[["Net sales", kpis.net_sales_minor], ["Payments collected", kpis.payments_collected_minor], ["Completed appointments", kpis.completed_appointments], ["Walk-ins", kpis.walk_ins]].map(([label, value]) => <article className="metric-card" key={String(label)}><span>{label}</span><strong>{String(value ?? "0")}</strong></article>)}</div>
        <h2>Revenue trend</h2><table><caption className="sr-only">Daily analytics trend</caption><thead><tr><th>Date</th><th>Branch</th><th>Net sales (minor)</th><th>Completed</th></tr></thead><tbody>{data.trend.map((row: any) => <tr key={`${row.businessDate}-${row.branchId}`}><td>{row.businessDate}</td><td>{row.branchId}</td><td>{row.netSalesMinor}</td><td>{row.completedAppointments}</td></tr>)}</tbody></table>
      </>}
    </section>
    {data?.metadata && <aside className="card"><h2>Data freshness</h2><p>Status: <strong>{data.metadata.freshnessStatus}</strong></p><p>As of: {data.metadata.asOf}</p><p>Revision: {data.metadata.projectionRevision} · Timezone: {data.metadata.timezone} · Currency: {data.metadata.currency}</p></aside>}
  </main>;
}
