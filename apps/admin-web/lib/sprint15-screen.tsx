/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type View = { title: string; endpoint: string; hint: string; create?: "vendor" | "request" };

const views: Record<string, View> = {
  "/admin/procurement": { title: "Procurement control center", endpoint: "/v1/procurement/vendors", hint: "Vendor-to-AP workflow with immutable snapshots and approval evidence." },
  "/admin/procurement/vendors": { title: "Vendors", endpoint: "/v1/procurement/vendors", hint: "Masked payment references and ON_HOLD vendors are blocked from new spend.", create: "vendor" },
  "/admin/procurement/purchase-requests": { title: "Purchase requests", endpoint: "/v1/procurement/purchase-requests", hint: "Submit and independently approve requested quantities.", create: "request" },
  "/admin/procurement/purchase-orders": { title: "Purchase orders", endpoint: "/v1/procurement/purchase-orders", hint: "Server-numbered, versioned and immutable after approval." },
  "/admin/procurement/receipts": { title: "Goods and service receipts", endpoint: "/v1/procurement/receipts", hint: "Partial receipt and tolerance caps are enforced in PostgreSQL." },
  "/admin/procurement/vendor-bills": { title: "Vendor bills", endpoint: "/v1/procurement/vendor-bills", hint: "Duplicate invoice guard and 3-way match before posting." },
  "/admin/procurement/ap": { title: "Accounts payable", endpoint: "/v1/procurement/ap/open-items", hint: "Aging, holds and outstanding balances are derived from allocations." },
  "/admin/procurement/payment-proposals": { title: "Payment proposals", endpoint: "/v1/procurement/payment-proposals", hint: "Reserve open-item amounts before dual-control approval." },
  "/admin/procurement/vendor-payments": { title: "Vendor payments", endpoint: "/v1/procurement/vendor-payments", hint: "Provider processing is worker-owned and unknown outcomes require reconciliation." },
  "/admin/procurement/credit-notes": { title: "Vendor credit notes", endpoint: "/v1/procurement/vendor-credit-notes", hint: "Exact bill-line eligibility and cumulative caps protect AP." },
  "/admin/procurement/returns": { title: "Vendor returns", endpoint: "/v1/procurement/vendor-returns", hint: "Returned quantity cannot exceed accepted receipt quantity." },
};
const nav = Object.entries(views);

async function read(path: string) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Permission denied for this procurement scope."), { forbidden: true });
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body.data;
}
function listOf(value: any): any[] { return Array.isArray(value) ? value : value ? [value] : []; }
function display(value: any) { if (value == null) return "—"; if (typeof value === "object") return JSON.stringify(value); return String(value); }

export default function Sprint15Screen() {
  const pathname = usePathname();
  const view = views[pathname] ?? views["/admin/procurement"]!;
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchLoading, setBranchLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchLoading(false);
    }).catch(() => { if (!cancelled) setBranchLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try { const value = listOf(await read(view.endpoint)); setRows(value); setState(value.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [view.endpoint]);
  useEffect(() => { void load(); }, [load]);
  const columns = useMemo(() => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((key) => !key.toLowerCase().includes("json")).slice(0, 8), [rows]);
  const fields: Array<[string, string]> = view.create === "vendor"
    ? [["code", "Code"], ["displayName", "Display name"], ["legalName", "Legal name"], ["currency", "Currency"], ["paymentTermsDays", "Payment terms (days)"]]
    : [["description", "Description"], ["quantity", "Quantity"], ["unitPriceMinor", "Unit price (minor)"], ["currency", "Currency"], ["reason", "Reason"]];

  async function create() {
    if (view.create === "request" && !branchId) { setError("Select an authorized branch before creating a purchase request."); return; }
    const payload = view.create === "vendor"
      ? { code: form.code, displayName: form.displayName, legalName: form.legalName || form.displayName, currency: form.currency || "VND", paymentTermsDays: Number(form.paymentTermsDays || 0) }
      : { branchId, currency: form.currency || "VND", reason: form.reason || "Operational procurement", lines: [{ description: form.description || "Procurement item", quantity: form.quantity || "1", unitPriceMinor: form.unitPriceMinor || "0" }] };
    const response = await authorizedFetch(view.endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error?.code === "VERSION_CONFLICT" ? "Version conflict. Refresh before retrying." : (body.error?.message ?? "Validation failed.")); return; }
    setNotice("Saved successfully."); setForm({}); await load();
  }
  async function action(row: any, command: string) {
    const response = await authorizedFetch(`${view.endpoint}/${row.id}/${command}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ version: row.version, reason: `Reviewed in ${view.title}` }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error?.code === "VERSION_CONFLICT" ? "Version conflict. Refresh before retrying." : (body.error?.message ?? "Command failed safely."));
    else { setNotice(`${command} completed.`); setError(""); await load(); }
  }

  return <main className="shell ops-shell">
    <nav className="topbar">{nav.map(([href, item]) => <a key={href} href={href}>{item.title}</a>)}</nav>
    <section className="card">
      <p className="eyebrow">SPRINT 15 · PROCUREMENT & AP</p>
      <div className="title-row"><div><h1>{view.title}</h1><p>{view.hint}</p></div><button onClick={() => void load()}>Refresh</button></div>
      {branchLoading && <p role="status" aria-busy="true">Loading authorized branches…</p>}
      {!branchLoading && branches.length > 1 && <label>Active branch<select value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Select a branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p aria-busy="true">Loading authoritative procurement data…</p>}
      {state === "forbidden" && <p role="alert">Permission denied. Your role or branch scope does not allow this view.</p>}
      {state === "error" && <div role="alert"><p>{error}</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "empty" && <div><p>No records yet.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "ready" && <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}<td>{row.status === "SUBMITTED" && view.title === "Purchase requests" && <button onClick={() => void action(row, "approve")}>Approve</button>}{row.status === "PENDING_APPROVAL" && view.title === "Vendor payments" && <button onClick={() => void action(row, "approve")}>Approve</button>}{row.status === "APPROVED" && view.title === "Vendor payments" && <button onClick={() => void action(row, "process")}>Queue processing</button>}</td></tr>)}</tbody></table></div>}
    </section>
    {view.create && <section className="card"><h2>{view.create === "vendor" ? "Add vendor" : "New purchase request"}</h2><div className="form-grid">{fields.map(([name, label]) => <label key={name}>{label}<input value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} required={name === "code" || name === "displayName" || name === "description"} /></label>)}</div><button onClick={() => void create()}>Save</button></section>}
    <aside className="card"><h2>Safeguards</h2><p>Every command is tenant/branch scoped, idempotent, version checked, audited and emitted through the durable outbox. Provider calls remain outside database transactions.</p></aside>
  </main>;
}
