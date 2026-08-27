/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";
import { legacyActionLabel, legacyColumnLabel, legacyText, legacyValue } from "./legacy-workspace-ui";

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
function display(value: any, key?: string) { return legacyValue(value, key); }

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
    <nav className="topbar">{nav.map(([href, item]) => <a key={href} href={href}>{legacyText(item.title)}</a>)}</nav>
    <section className="card">
      <p className="eyebrow">NAILSOFT · MUA HÀNG & CÔNG NỢ PHẢI TRẢ</p>
      <div className="title-row"><div><h1>{legacyText(view.title)}</h1><p>{legacyText(view.hint)}</p></div><button onClick={() => void load()}>Làm mới</button></div>
      {branchLoading && <p role="status" aria-busy="true">Đang tải chi nhánh được cấp quyền…</p>}
      {!branchLoading && branches.length > 1 && <label>Chi nhánh hoạt động<select value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Chọn chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {notice && <p role="status">{notice}</p>}
      {state === "loading" && <p aria-busy="true">Đang tải dữ liệu mua hàng từ máy chủ…</p>}
      {state === "forbidden" && <p role="alert">Không có quyền truy cập. Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</p>}
      {state === "error" && <div role="alert"><p>{error}</p><button onClick={() => void load()}>Thử lại</button></div>}
      {state === "empty" && <div><p>Chưa có bản ghi trong phạm vi được cấp quyền.</p><button onClick={() => void load()}>Làm mới</button></div>}
      {state === "ready" && <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column} scope="col">{legacyColumnLabel(column)}</th>)}<th scope="col">Thao tác</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((column) => <td key={column} data-label={legacyColumnLabel(column)}>{display(row[column], column)}</td>)}<td data-label="Thao tác">{row.status === "SUBMITTED" && view.title === "Purchase requests" && <button onClick={() => void action(row, "approve")}>{legacyActionLabel("approve")}</button>}{row.status === "PENDING_APPROVAL" && view.title === "Vendor payments" && <button onClick={() => void action(row, "approve")}>{legacyActionLabel("approve")}</button>}{row.status === "APPROVED" && view.title === "Vendor payments" && <button onClick={() => void action(row, "process")}>{legacyActionLabel("process")}</button>}</td></tr>)}</tbody></table></div>}
    </section>
    {view.create && <section className="card"><h2>{view.create === "vendor" ? "Thêm nhà cung cấp" : "Tạo yêu cầu mua hàng"}</h2><div className="form-grid">{fields.map(([name, label]) => <label key={name}>{legacyColumnLabel(label)}<input value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} required={name === "code" || name === "displayName" || name === "description"} /></label>)}</div><button onClick={() => void create()}>Lưu</button></section>}
    <aside className="card"><h2>Kiểm soát an toàn</h2><p>Mọi lệnh đều giới hạn theo tenant/chi nhánh, có idempotency, kiểm tra phiên bản, audit và outbox bền vững. Gọi nhà cung cấp nằm ngoài transaction cơ sở dữ liệu.</p></aside>
  </main>;
}
