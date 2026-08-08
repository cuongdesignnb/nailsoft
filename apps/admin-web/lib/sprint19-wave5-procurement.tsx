/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string };
type ProcurementView = { title: string; endpoint: string; kind: string; description: string; create?: "vendor" | "request" };

const views: Record<string, ProcurementView> = {
  "/admin/procurement": { title: "Procurement control center", endpoint: "/v1/procurement/vendors", kind: "vendors", description: "One workspace for supplier, purchasing, AP and payment controls." },
  "/admin/procurement/vendors": { title: "Vendors", endpoint: "/v1/procurement/vendors", kind: "vendors", description: "Supplier directory with masked payment references and lifecycle controls.", create: "vendor" },
  "/admin/procurement/purchase-requests": { title: "Purchase requests", endpoint: "/v1/procurement/purchase-requests", kind: "requests", description: "Request spend with branch context, version checks and independent approval.", create: "request" },
  "/admin/procurement/purchase-orders": { title: "Purchase orders", endpoint: "/v1/procurement/purchase-orders", kind: "orders", description: "Server-numbered orders remain immutable after approval." },
  "/admin/procurement/receipts": { title: "Goods and service receipts", endpoint: "/v1/procurement/receipts", kind: "receipts", description: "Partial receipt and tolerance caps are enforced by the API." },
  "/admin/procurement/vendor-bills": { title: "Vendor bills", endpoint: "/v1/procurement/vendor-bills", kind: "bills", description: "Duplicate invoice and three-way match safeguards remain server-authoritative." },
  "/admin/procurement/ap": { title: "Accounts payable", endpoint: "/v1/procurement/ap/open-items", kind: "ap", description: "Open balances and holds are derived from AP allocations." },
  "/admin/procurement/payment-proposals": { title: "Payment proposals", endpoint: "/v1/procurement/payment-proposals", kind: "proposals", description: "Reserve open-item amounts before dual-control payment approval." },
  "/admin/procurement/vendor-payments": { title: "Vendor payments", endpoint: "/v1/procurement/vendor-payments", kind: "payments", description: "Worker-owned provider processing and reconciliation evidence." },
  "/admin/procurement/credit-notes": { title: "Vendor credit notes", endpoint: "/v1/procurement/vendor-credit-notes", kind: "credits", description: "Exact bill-line eligibility and cumulative caps protect AP." },
  "/admin/procurement/returns": { title: "Vendor returns", endpoint: "/v1/procurement/vendor-returns", kind: "returns", description: "Return quantities and branch scope are checked by the existing workflow." },
};

const nav = Object.entries(views);
const columns: Record<string, string[]> = {
  vendors: ["code", "displayName", "currency", "status", "version"],
  requests: ["requestNumber", "branchId", "currency", "requestedTotalMinor", "status", "version"],
  orders: ["poNumber", "branchId", "vendorId", "currency", "totalMinor", "status", "version"],
  receipts: ["receiptNumber", "branchId", "status", "version", "createdAt"],
  bills: ["billNumber", "branchId", "vendorName", "currency", "totalMinor", "status", "version"],
  ap: ["billNumber", "branchId", "vendorName", "outstandingMinor", "dueDate", "status"],
  proposals: ["proposalNumber", "branchId", "vendorName", "currency", "totalMinor", "status", "version"],
  payments: ["paymentReference", "branchId", "vendorName", "currency", "amountMinor", "status", "version"],
  credits: ["creditNoteNumber", "branchId", "vendorName", "currency", "amountMinor", "status", "version"],
  returns: ["branchId", "vendorName", "purchaseOrderNumber", "reason", "status", "version"],
};

export function isWave5ProcurementPath(pathname: string) {
  return Object.keys(views).some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function listOf(value: any): any[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function display(value: any) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return value.displayName ?? value.name ?? value.code ?? "—";
  return String(value);
}

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Permission denied for this procurement scope."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body.data;
}

function actionFor(view: ProcurementView, row: any) {
  const version = row.version == null ? {} : { version: row.version };
  const transitions: Record<string, Array<[string, string, Record<string, unknown>]>> = {
    requests: [["DRAFT", "submit", version], ["SUBMITTED", "approve", { ...version, reason: "Approved in procurement workspace" }], ["SUBMITTED", "reject", { ...version, reason: "Rejected in procurement workspace" }]],
    orders: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "send", version]],
    receipts: [["DRAFT", "receive", version], ["RECEIVED", "accept", version]],
    bills: [["MATCHED", "approve", version], ["APPROVED", "post", version]],
    ap: [["OPEN", "hold", { reason: "Held in AP workspace" }], ["HOLD", "release-hold", { reason: "Released in AP workspace" }]],
    proposals: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["DRAFT", "cancel", { ...version, reason: "Cancelled in procurement workspace" }]],
    payments: [["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "process", version]],
    credits: [["DRAFT", "submit", version], ["SUBMITTED", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "post", version], ["POSTED", "apply", version]],
    returns: [["DRAFT", "submit", version], ["PENDING_APPROVAL", "approve", { ...version, reason: "Approved in procurement workspace" }], ["APPROVED", "dispatch", version], ["DISPATCHED", "complete", version]],
  };
  return (transitions[view.kind] ?? []).filter(([status]) => status === row.status).map(([, command, body]) => ({ command, body }));
}

export default function Sprint19Wave5Procurement({ pathname }: { pathname: string }) {
  const route = Object.keys(views).sort((left, right) => right.length - left.length).find((key) => pathname === key || pathname.startsWith(`${key}/`)) ?? "/admin/procurement";
  const view = views[route]!;
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchLoading, setBranchLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchLoading(false);
    }).catch((e: any) => { if (!cancelled) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); setBranchLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = listOf(await read(view.endpoint)); setRows(value); setState(value.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function command(row: any, commandName: string, body: Record<string, unknown>) {
    if (!navigator.onLine) { setNotice("Internet connection required. Procurement commands are not queued offline."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await authorizedFetch(`${view.endpoint}/${row.id}/${commandName}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.code === "VERSION_CONFLICT" ? "Version conflict. Refresh before retrying." : (result.error?.message ?? "Command failed safely."));
      setNotice(`${commandName} completed and the server view was refreshed.`); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (view.create === "request" && !branchId) { setError("Select an authorized branch before creating a purchase request."); return; }
    const payload = view.create === "vendor"
      ? { code: form.code, displayName: form.displayName, legalName: form.legalName || form.displayName, currency: form.currency || "VND", paymentTermsDays: Number(form.paymentTermsDays || 0) }
      : { branchId, currency: form.currency || "VND", reason: form.reason || "Operational procurement", lines: [{ description: form.description || "Procurement item", quantity: form.quantity || "1", unitPriceMinor: form.unitPriceMinor || "0" }] };
    setBusy(true); setError("");
    try {
      const response = await authorizedFetch(view.endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message ?? "Validation failed.");
      setNotice("Created successfully after server confirmation."); setForm({}); await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const visibleColumns = columns[view.kind] ?? [];
  const fields: Array<[string, string]> = view.create === "vendor"
    ? [["code", "Code"], ["displayName", "Display name"], ["legalName", "Legal name"], ["currency", "Currency"], ["paymentTermsDays", "Payment terms (days)"]]
    : [["description", "Description"], ["quantity", "Quantity"], ["unitPriceMinor", "Unit price (minor)"], ["currency", "Currency"], ["reason", "Reason"]];

  return <main className="shell ops-shell">
    <nav className="topbar" aria-label="Procurement navigation">{nav.map(([href, item]) => <a key={href} href={href} aria-current={href === route ? "page" : undefined}>{item.title}</a>)}</nav>
    <section className="card">
      <p className="eyebrow">SPRINT 19 · WAVE 5 · PROCUREMENT</p>
      <div className="title-row"><div><h1>{view.title}</h1><p className="hint">{view.description}</p></div><button onClick={() => void load()} disabled={state === "loading"}>Refresh</button></div>
      {branchLoading && <p role="status" aria-busy="true">Loading authorized branches…</p>}
      {!branchLoading && branches.length > 1 && <label>Active branch<select aria-label="Active branch" value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Select an authorized branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {state === "loading" && <p role="status" aria-busy="true">Loading authoritative procurement data…</p>}
      {state === "forbidden" && <div role="alert" className="state"><h2>Permission denied</h2><p>Your role or branch scope does not allow this view.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "error" && <div role="alert" className="state"><h2>Unable to load procurement data</h2><p>{error}</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "empty" && <div className="state"><h2>No records yet</h2><p>There is no data in the authorized scope.</p><button onClick={() => void load()}>Retry</button></div>}
      {error && state !== "error" && <p role="alert">{error}</p>}
      {state === "ready" && <div className="table-wrap"><table><thead><tr>{visibleColumns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{visibleColumns.map((column) => <td key={column} data-label={column}>{display(row[column])}</td>)}<td>{actionFor(view, row).map((action) => <button key={action.command} disabled={busy} onClick={() => void command(row, action.command, action.body)}>{action.command}</button>)}</td></tr>)}</tbody></table></div>}
    </section>
    {view.create && <section className="card"><h2>{view.create === "vendor" ? "Add vendor" : "New purchase request"}</h2>{view.create === "request" && !branchId && !branchLoading && <p role="alert">Select an authorized branch before submitting this request.</p>}<form className="form-grid" onSubmit={(event) => void create(event)}>{fields.map(([name, label]) => <label key={name}>{label}<input value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} required={name === "code" || name === "displayName" || name === "description"} /></label>)}<button type="submit" disabled={busy || (view.create === "request" && !branchId)}>Create</button></form></section>}
    <aside className="card"><h2>Workflow safeguards</h2><p>Commands use idempotency keys, version checks, tenant and branch authorization, audit evidence and durable outbox events. Provider calls remain worker-owned.</p></aside>
  </main>;
}
