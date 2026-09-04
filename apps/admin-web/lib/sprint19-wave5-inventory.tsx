/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";

type AsyncState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string };
type Screen = { title: string; endpoint: string; branchScoped?: boolean; kind: string; description: string };

const ACTIVE_BRANCH = "__ACTIVE_BRANCH__";
const screens: Record<string, Screen> = {
  "/admin/inventory": { title: "Inventory control center", endpoint: "/v1/inventory/stock?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "stock", description: "Server-authoritative on-hand, reserved and available quantities." },
  "/admin/inventory/items": { title: "Inventory items", endpoint: "/v1/inventory/items", kind: "items", description: "Manage active consumables and retail items without editing stock balances directly." },
  "/admin/inventory/locations": { title: "Stock locations", endpoint: "/v1/inventory/locations?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "locations", description: "Branch-scoped stock rooms and operational locations." },
  "/admin/inventory/stock": { title: "Stock availability", endpoint: "/v1/inventory/stock?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "stock", description: "Server-authoritative on-hand, reserved and available quantities." },
  "/admin/inventory/lots": { title: "Lot and expiry", endpoint: "/v1/inventory/lots?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "lots", description: "Traceable lot status and expiry visibility." },
  "/admin/inventory/alerts": { title: "Inventory alerts", endpoint: "/v1/inventory/alerts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "alerts", description: "Review and acknowledge operational stock alerts." },
  "/admin/inventory/suppliers": { title: "Inventory suppliers", endpoint: "/v1/inventory/suppliers", kind: "suppliers", description: "Supplier directory used by inventory purchasing workflows." },
  "/admin/inventory/purchase-orders": { title: "Inventory purchase orders", endpoint: "/v1/inventory/purchase-orders?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "purchaseOrders", description: "Inventory purchase orders remain separate from Procurement purchase orders." },
  "/admin/inventory/receipts": { title: "Goods receipts", endpoint: "/v1/inventory/receipts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "receipts", description: "Receive and post goods through the inventory receipt lifecycle." },
  "/admin/inventory/transfers": { title: "Stock transfers", endpoint: "/v1/inventory/transfers?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "transfers", description: "Request, approve, ship and receive stock across authorized branches." },
  "/admin/inventory/adjustments": { title: "Stock adjustments", endpoint: "/v1/inventory/adjustments?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "adjustments", description: "Review reasoned adjustments with version checks and approval." },
  "/admin/inventory/counts": { title: "Blind stock counts", endpoint: "/v1/inventory/counts?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "counts", description: "Count first, review variance later; expected stock stays hidden before review." },
  "/admin/inventory/service-recipes": { title: "Service material recipes", endpoint: "/v1/inventory/service-recipes?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "recipes", description: "Define branch-scoped service material consumption." },
  "/admin/inventory/reports": { title: "Inventory ledger", endpoint: "/v1/inventory/ledger?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "ledger", description: "Append-only inventory movement history." },
  "/admin/inventory/valuation": { title: "Inventory valuation", endpoint: "/v1/inventory/reports/valuation?branchId=__ACTIVE_BRANCH__", branchScoped: true, kind: "valuation", description: "Cost and valuation data is permission-gated by the API." },
};

export function isWave5InventoryPath(pathname: string) {
  return Object.keys(screens).some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

async function read(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Permission denied for this inventory scope."), { forbidden: true });
  if (!response.ok) throw new Error(`${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Retry safely"}`);
  return body.data;
}

function rowsOf(value: any): any[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function text(value: any) { if (value == null || value === "") return "—"; if (typeof value === "boolean") return value ? "Yes" : "No"; return String(value); }
function titleFor(key: string) { return key.replace(/([A-Z])/g, " $1").replace(/^./, (v) => v.toUpperCase()); }

const columns: Record<string, string[]> = {
  items: ["sku", "name", "status", "itemType", "quantityPrecision"],
  locations: ["code", "name", "locationType", "status"],
  stock: ["sku", "name", "onHand", "reserved", "available", "expiryDate", "lotStatus", "locationType"],
  lots: ["lotId", "expiryDate", "status"],
  alerts: ["severity", "alertType", "status", "createdAt"],
  suppliers: ["code", "name", "status"],
  purchaseOrders: ["poNumber", "status", "currency", "totalMinor", "createdAt"],
  receipts: ["receiptNumber", "status", "receivedAt", "createdAt"],
  transfers: ["transferNumber", "status", "sourceBranchId", "destinationBranchId", "createdAt"],
  adjustments: ["reasonCode", "status", "quantityDelta", "version", "createdAt"],
  counts: ["status", "blind", "version", "createdAt"],
  recipes: ["serviceId", "name", "status", "branchId"],
  ledger: ["entryType", "quantityDelta", "reasonCode", "occurredAt"],
  valuation: ["branchId", "onHand", "totalCostMinor", "generatedAt"],
};

function actionFor(kind: string, row: any): Array<{ label: string; path: string; body?: Record<string, unknown> | undefined }> {
  const version = row.version == null ? undefined : { version: row.version };
  if (kind === "items" && row.status === "ACTIVE") return [{ label: "Archive", path: `/v1/inventory/items/${row.id}/archive`, body: version }];
  if (kind === "items" && row.status === "ARCHIVED") return [{ label: "Activate", path: `/v1/inventory/items/${row.id}/activate`, body: version }];
  if (kind === "alerts" && row.status === "OPEN") return [{ label: "Acknowledge", path: `/v1/inventory/alerts/${row.id}/acknowledge` }];
  if (kind === "purchaseOrders" && row.status === "DRAFT") return [{ label: "Submit", path: `/v1/inventory/purchase-orders/${row.id}/submit`, body: version }];
  if (kind === "purchaseOrders" && row.status === "SUBMITTED") return [{ label: "Approve", path: `/v1/inventory/purchase-orders/${row.id}/approve`, body: version }];
  if (kind === "receipts" && row.status === "DRAFT") return [{ label: "Post", path: `/v1/inventory/receipts/${row.id}/post`, body: version }];
  if (kind === "transfers" && row.status === "DRAFT") return [{ label: "Request", path: `/v1/inventory/transfers/${row.id}/request`, body: version }];
  if (kind === "transfers" && row.status === "REQUESTED") return [{ label: "Approve", path: `/v1/inventory/transfers/${row.id}/approve`, body: version }];
  if (kind === "transfers" && row.status === "APPROVED") return [{ label: "Ship", path: `/v1/inventory/transfers/${row.id}/ship`, body: version }];
  if (kind === "transfers" && row.status === "IN_TRANSIT") return [{ label: "Receive", path: `/v1/inventory/transfers/${row.id}/receive`, body: version }];
  if (kind === "adjustments" && row.status === "PENDING") return [{ label: "Approve", path: `/v1/inventory/adjustments/${row.id}/approve`, body: { ...version, reason: "Reviewed in inventory workspace" } }];
  if (kind === "adjustments" && row.status === "APPROVED") return [{ label: "Post", path: `/v1/inventory/adjustments/${row.id}/post`, body: version }];
  if (kind === "counts" && row.status === "DRAFT") return [{ label: "Start count", path: `/v1/inventory/counts/${row.id}/start`, body: version }];
  if (kind === "counts" && row.status === "COUNTING") return [{ label: "Start review", path: `/v1/inventory/counts/${row.id}/start-review`, body: version }];
  if (kind === "counts" && ["REVIEW", "SUBMITTED"].includes(row.status)) return [{ label: "Approve", path: `/v1/inventory/counts/${row.id}/approve`, body: version }];
  if (kind === "counts" && row.status === "APPROVED") return [{ label: "Post", path: `/v1/inventory/counts/${row.id}/post`, body: version }];
  return [];
}

export default function Sprint19Wave5Inventory({ pathname }: { pathname: string }) {
  const route = Object.keys(screens).sort((left, right) => right.length - left.length).find((key) => pathname === key || pathname.startsWith(`${key}/`)) ?? "/admin/inventory/stock";
  const screen = screens[route]!;
  const [branchId, setBranchId] = useState<string | undefined>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchState, setBranchState] = useState<AsyncState>("loading");
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [itemOptions, setItemOptions] = useState<any[]>([]);
  const [uomOptions, setUomOptions] = useState<any[]>([]);
  const [locationOptions, setLocationOptions] = useState<any[]>([]);
  const intentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected);
      setBranchState("ready");
    }).catch((e) => { if (!cancelled) { setError(e.message); setBranchState(e.forbidden ? "forbidden" : "error"); } });
    return () => { cancelled = true; };
  }, []);

  const endpoint = screen.branchScoped && !branchId ? undefined : screen.endpoint.replace(ACTIVE_BRANCH, encodeURIComponent(branchId ?? ""));
  const load = useCallback(async () => {
    if (!endpoint) { setRows([]); setState("empty"); return; }
    setState("loading"); setError("");
    try { const nextRows = rowsOf(await read(endpoint)); setRows(nextRows); setState(nextRows.length ? "ready" : "empty"); }
    catch (e: any) { setError(e.message); setState(e.forbidden ? "forbidden" : "error"); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, { auth: { token: session.accessToken }, transports: ["websocket"] });
    const refresh = () => void load();
    ["inventory.updated", "inventory.alerts.updated", "pos.order.updated"].forEach((event) => socket.on(event, refresh));
    return () => { socket.disconnect(); };
  }, [load]);
  useEffect(() => {
    const locationsPromise = branchId
      ? read(`/v1/inventory/locations?branchId=${encodeURIComponent(branchId)}`).catch(() => [])
      : Promise.resolve([]);
    void Promise.all([read("/v1/inventory/items").catch(() => []), read("/v1/inventory/uoms").catch(() => []), locationsPromise]).then(([items, uoms, locations]) => {
      setItemOptions(rowsOf(items));
      setUomOptions(rowsOf(uoms));
      setLocationOptions(rowsOf(locations));
    });
  }, [branchId]);

  async function run(path: string, body: Record<string, unknown> = {}) {
    if (!navigator.onLine) { setNotice("Internet connection required. Inventory writes are not queued offline."); return; }
    setBusy(true); setNotice("");
    const key = intentKeys.current[path] ?? (intentKeys.current[path] = crypto.randomUUID());
    try {
      await read(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
      delete intentKeys.current[path];
      setNotice("Saved. The server-authoritative inventory view was refreshed.");
      await load();
    } catch (e: any) { setNotice(e.message); } finally { setBusy(false); }
  }

  const visibleColumns = columns[screen.kind] ?? [];
  const needsBranch = Boolean(screen.branchScoped);
  return <main className="shell ops-shell">
    <section className="card">
      <p className="eyebrow">KHO HÀNG</p>
      <div className="title-row"><div><h1>{screen.title}</h1><p className="hint">{screen.description}</p></div><button onClick={() => void load()} disabled={state === "loading"}>Refresh</button></div>
      {branchState === "loading" && <p role="status" aria-busy="true">Loading authorized branches…</p>}
      {branchState === "forbidden" && <p role="alert">Permission denied. Branch context is unavailable.</p>}
      {branches.length > 1 && <label>Active branch<select aria-label="Active branch" value={branchId ?? ""} onChange={(event) => { const next = event.target.value || undefined; setBranchId(next); setActiveBranchId(next); }}><option value="">Select an authorized branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      {needsBranch && !branchId && branchState === "ready" && <p role="alert">Select an authorized branch to view this screen. The server remains the authorization source.</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {state === "loading" && <div role="status" aria-busy="true" className="skeleton">Loading authoritative inventory data…</div>}
      {state === "forbidden" && <div role="alert" className="state"><h2>Permission denied</h2><p>Your role or branch scope does not allow this inventory view.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "error" && <div role="alert" className="state"><h2>Unable to load inventory</h2><p>{error}</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "empty" && <div className="state"><h2>No records yet</h2><p>There is no data for the selected authorized scope.</p><button onClick={() => void load()}>Retry</button></div>}
      {state === "ready" && <InventoryTable rows={rows} kind={screen.kind} columns={visibleColumns} busy={busy} run={run} />}
    </section>
    {(["items", "locations", "suppliers", "adjustments", "transfers", "counts"].includes(screen.kind)) && <InventoryCreate kind={screen.kind} branchId={branchId} branches={branches} items={itemOptions} uoms={uomOptions} locations={locationOptions} run={run} />}
  </main>;
}

function InventoryTable({ rows, kind, columns, busy, run }: { rows: any[]; kind: string; columns: string[]; busy: boolean; run: (path: string, body?: Record<string, unknown>) => Promise<void> }) {
  if (!rows.length) return null;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{titleFor(column)}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? `${kind}-${index}`}>{columns.map((column) => <td key={column} data-label={titleFor(column)}>{text(row[column])}</td>)}<td>{actionFor(kind, row).map((action) => <button key={action.path} disabled={busy} onClick={() => void run(action.path, action.body)}>{action.label}</button>)}</td></tr>)}</tbody></table></div>;
}

function InventoryCreate({ kind, branchId, branches, items, uoms, locations, run }: { kind: string; branchId?: string | undefined; branches: Branch[]; items: any[]; uoms: any[]; locations: any[]; run: (path: string, body?: Record<string, unknown> | undefined) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const value = (name: string) => form[name] ?? "";
  const set = (name: string, next: string) => setForm((current) => ({ ...current, [name]: next }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (["locations", "adjustments", "transfers", "counts"].includes(kind) && !branchId) return;
    const body: Record<string, unknown> = kind === "items"
      ? { sku: value("sku"), name: { "vi-VN": value("name"), "en-US": value("name") }, baseUomId: value("uomId"), itemType: value("itemType") || "CONSUMABLE", trackLot: true, trackExpiry: true, quantityPrecision: 3, currency: "VND" }
      : kind === "locations"
        ? { branchId, code: value("code"), name: value("name"), locationType: value("locationType") || "STOCKROOM" }
        : kind === "suppliers"
          ? { code: value("code"), name: value("name"), contact: { email: value("email") || undefined } }
          : kind === "adjustments"
            ? { branchId, locationId: value("locationId"), itemId: value("itemId"), quantityDelta: value("quantityDelta"), reasonCode: value("reasonCode") || "PHYSICAL_CORRECTION", note: value("note") }
            : kind === "transfers"
              ? { sourceBranchId: branchId, destinationBranchId: value("destinationBranchId"), sourceLocationId: value("sourceLocationId"), destinationLocationId: value("destinationLocationId"), lines: [{ itemId: value("itemId"), quantity: value("quantity") }] }
              : { branchId, locationId: value("locationId"), blind: true, items: [{ itemId: value("itemId"), lotId: value("lotId") || null }] };
    const endpoint = { items: "/v1/inventory/items", locations: "/v1/inventory/locations", suppliers: "/v1/inventory/suppliers", adjustments: "/v1/inventory/adjustments", transfers: "/v1/inventory/transfers", counts: "/v1/inventory/counts" }[kind]!;
    await run(endpoint, body); setForm({}); setOpen(false);
  }
  const option = (name: string, label: string, values: any[]) => <label>{label}<select name={name} value={value(name)} onChange={(event) => set(name, event.target.value)} required><option value="">Select {label.toLowerCase()}</option>{values.map((entry) => <option key={entry.id} value={entry.id}>{entry.name ?? entry.code ?? entry.sku ?? entry.id}</option>)}</select></label>;
  return <section className="card"><div className="title-row"><h2>Operational command</h2><button onClick={() => setOpen((current) => !current)}>{open ? "Close" : "New"}</button></div>{open && <form className="form-grid" onSubmit={(event) => void submit(event)}>{kind === "items" && <><label>SKU<input required value={value("sku")} onChange={(event) => set("sku", event.target.value)} /></label><label>Name<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label>{option("uomId", "Base unit", uoms)}</>}{kind === "locations" && <><label>Code<input required value={value("code")} onChange={(event) => set("code", event.target.value)} /></label><label>Name<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label></>}{kind === "suppliers" && <><label>Code<input required value={value("code")} onChange={(event) => set("code", event.target.value)} /></label><label>Name<input required value={value("name")} onChange={(event) => set("name", event.target.value)} /></label><label>Email<input type="email" value={value("email")} onChange={(event) => set("email", event.target.value)} /></label></>}{kind === "adjustments" && <>{option("itemId", "Item", items)}{option("locationId", "Location", locations)}<label>Quantity delta<input required value={value("quantityDelta")} onChange={(event) => set("quantityDelta", event.target.value)} /></label><label>Reason<input required value={value("note")} onChange={(event) => set("note", event.target.value)} /></label></>}{kind === "transfers" && <>{option("destinationBranchId", "Destination branch", branches.filter((branch) => branch.id !== branchId))}{option("itemId", "Item", items)}{option("sourceLocationId", "Source location", locations)}{option("destinationLocationId", "Destination location", locations)}<label>Quantity<input required value={value("quantity")} onChange={(event) => set("quantity", event.target.value)} /></label></>}{kind === "counts" && <>{option("itemId", "Item", items)}{option("locationId", "Location", locations)}</>}<button type="submit">Submit command</button></form>}</section>;
}
