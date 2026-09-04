/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string };
type AssetView = { title: string; endpoint: string; kind: string; description: string };

const views: Record<string, AssetView> = {
  "/admin/assets": { title: "Fixed asset register", endpoint: "/v1/assets", kind: "register", description: "Tenant and branch scoped asset register with immutable economics." },
  "/admin/assets/candidates": { title: "Asset candidates", endpoint: "/v1/assets/candidates", kind: "candidates", description: "Classify candidates before capitalization or expense treatment." },
  "/admin/assets/capitalization": { title: "Capitalization approvals", endpoint: "/v1/assets/capitalization-requests", kind: "capitalization", description: "Independent approval protects capitalization evidence." },
  "/admin/assets/depreciation": { title: "Depreciation runs", endpoint: "/v1/assets/depreciation-runs", kind: "depreciation", description: "Versioned depreciation runs with explicit calculate, approve and post steps." },
  "/admin/assets/maintenance": { title: "Maintenance work orders", endpoint: "/v1/assets/maintenance-work-orders", kind: "maintenance", description: "Schedule, assign, execute and verify maintenance without editing asset economics." },
  "/admin/assets/transfers": { title: "Asset transfers", endpoint: "/v1/assets/transfers", kind: "transfers", description: "Transfer assets between authorized branches with dual control." },
  "/admin/assets/counts": { title: "Asset counts", endpoint: "/v1/assets/count-sessions", kind: "counts", description: "Blind count snapshots keep expected values hidden until review." },
  "/admin/assets/inspections": { title: "Inspections", endpoint: "/v1/assets/inspections", kind: "inspections", description: "Record inspection evidence and follow-up status." },
  "/admin/assets/impairments": { title: "Impairments", endpoint: "/v1/assets/impairments", kind: "impairments", description: "Review recoverability evidence before posting impairment." },
  "/admin/assets/disposals": { title: "Disposals", endpoint: "/v1/assets/disposals", kind: "disposals", description: "Dispose assets only through the approved lifecycle." },
  "/admin/assets/reports": { title: "Asset reports", endpoint: "/v1/assets/reports/register", kind: "reports", description: "Read-only register and valuation evidence from the accounting source." },
};

const columns: Record<string, string[]> = {
  register: ["assetCode", "name", "branchId", "status", "currency", "grossCarryingAmountMinor", "version"],
  candidates: ["id", "sourceType", "description", "amountMinor", "status", "version"],
  capitalization: ["id", "assetId", "amountMinor", "status", "version", "createdAt"],
  depreciation: ["id", "periodStart", "periodEnd", "status", "version"],
  maintenance: ["id", "assetId", "title", "scheduledStartAt", "status", "version"],
  transfers: ["id", "assetId", "sourceBranchId", "destinationBranchId", "status", "version"],
  counts: ["id", "branchId", "status", "blind", "version", "createdAt"],
  inspections: ["id", "assetId", "inspectionType", "status", "inspectedAt", "version"],
  impairments: ["id", "assetId", "amountMinor", "status", "version", "createdAt"],
  disposals: ["id", "assetId", "proceedsMinor", "status", "gainLossMinor", "version"],
  reports: ["assetCode", "name", "branchId", "status", "nbvMinor"],
};

export function isWave5AssetsPath(pathname: string) {
  return Object.keys(views).some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function display(value: any) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return value.displayName ?? value.name ?? value.code ?? "—";
  return String(value);
}
function listOf(value: any): any[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Permission denied for this asset scope."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load asset data.");
  return body.data;
}

function actions(kind: string, row: any) {
  const version = row.version == null ? {} : { version: row.version };
  const map: Record<string, Array<[string, string, Record<string, unknown>]>> = {
    candidates: [["PENDING_REVIEW", "submit-review", version], ["PENDING_REVIEW", "approve-capitalization", { ...version, reason: "Reviewed in asset workspace" }], ["PENDING_REVIEW", "classify-expense", version]],
    capitalization: [["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in asset workspace" }], ["APPROVED", "process", version], ["PENDING_APPROVAL", "reject", { ...version, reason: "Rejected in asset workspace" }]],
    depreciation: [["DRAFT", "calculate", version], ["CALCULATED", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in asset workspace" }], ["APPROVED", "post", version]],
    maintenance: [["DRAFT", "schedule", version], ["SCHEDULED", "assign", version], ["ASSIGNED", "start", version], ["IN_PROGRESS", "complete", version], ["COMPLETED", "verify", { ...version, reason: "Verified in asset workspace" }]],
    transfers: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in asset workspace" }], ["APPROVED", "dispatch", version], ["DISPATCHED", "receive", version]],
    impairments: [["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in asset workspace" }], ["APPROVED", "post", version]],
    disposals: [["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in asset workspace" }], ["APPROVED", "complete", version]],
  };
  return (map[kind] ?? []).filter(([status]) => status === row.status).map(([, command, body]) => ({ command, body }));
}

export default function Sprint19Wave5Assets({ pathname }: { pathname: string }) {
  const route = Object.keys(views).sort((a, b) => b.length - a.length).find((key) => pathname === key || pathname.startsWith(`${key}/`)) ?? "/admin/assets";
  const view = views[route]!;
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const intentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches); setBranchId(selected);
    }).catch((e: any) => { if (!cancelled) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); } });
    return () => { cancelled = true; };
  }, []);
  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = listOf(await read(view.endpoint)); setRows(value); setState(value.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function run(row: any, command: string, body: Record<string, unknown>) {
    if (!navigator.onLine) { setNotice("Internet connection required. Asset commands are not queued offline."); return; }
    setBusy(true); setNotice(""); setError("");
    const intent = `${row.id}:${command}`;
    const key = intentKeys.current[intent] ?? (intentKeys.current[intent] = crypto.randomUUID());
    try {
      const response = await authorizedFetch(`${view.endpoint}/${row.id}/${command}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.code === "VERSION_CONFLICT" ? "Version conflict. Refresh before retrying." : (result.error?.message ?? "Command failed safely."));
      delete intentKeys.current[intent];
      setNotice(`${command} completed after server confirmation.`); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const visibleColumns = columns[view.kind] ?? [];
  return <main className="shell ops-shell">
    <section className="card">
      <p className="eyebrow">TÀI SẢN CỐ ĐỊNH</p>
      <div className="title-row"><div><h1>{view.title}</h1><p className="hint">{view.description}</p></div><button onClick={() => void load()} disabled={state === "loading"}>Refresh</button></div>
      {branches.length > 1 && <label>Active branch<select aria-label="Active branch" value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Select an authorized branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {state === "loading" && <p role="status" aria-busy="true">Loading authoritative asset data…</p>}
      {state === "forbidden" && <div role="alert" className="state"><h2>Permission denied</h2><p>Your role or branch scope does not allow this view.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "error" && <div role="alert" className="state"><h2>Unable to load asset data</h2><p>{error}</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "empty" && <div className="state"><h2>No records yet</h2><p>There is no data in the authorized scope.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "ready" && <div className="table-wrap"><table><thead><tr>{visibleColumns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{visibleColumns.map((column) => <td key={column} data-label={column}>{display(row[column])}</td>)}<td>{actions(view.kind, row).map((action) => <button key={action.command} disabled={busy} onClick={() => void run(row, action.command, action.body)}>{action.command}</button>)}</td></tr>)}</tbody></table></div>}
    </section>
    <aside className="card"><h2>Controls</h2><p>Commands use explicit transitions, idempotency keys, optimistic refresh and audit evidence. Posted economics cannot be edited.</p></aside>
  </main>;
}
