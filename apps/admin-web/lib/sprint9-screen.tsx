/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";
type State = "loading" | "ready" | "empty" | "error" | "forbidden";
const branch = "20000000-0000-4000-8000-000000000001";
async function api(path: string, init?: RequestInit) {
  const res = await authorizedFetch(path, init),
    body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403)
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!res.ok)
    throw new Error(
      `${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Retry safely"}`,
    );
  return body.data;
}
async function command(path: string, body: unknown = {}) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Inventory commands are not queued offline.",
    );
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
function useData(path: string) {
  const [state, setState] = useState<State>("loading"),
    [data, setData] = useState<any[]>([]),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const v = await api(path),
        rows = Array.isArray(v) ? v : v ? [v] : [];
      setData(rows);
      setState(rows.length ? "ready" : "empty");
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const s = activeSession();
    if (!s.accessToken) return;
    const socket = io(`${s.api}/scheduling`, {
      auth: { token: s.accessToken },
      transports: ["websocket"],
    });
    [
      "inventory.updated",
      "inventory.alerts.updated",
      "pos.order.updated",
    ].forEach((e) => socket.on(e, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load]);
  return { state, data, error, load };
}
const configs: Record<string, { title: string; path: string; kind: string }> = {
  "/admin/inventory/items": {
    title: "Inventory items",
    path: "/v1/inventory/items",
    kind: "item",
  },
  "/admin/inventory/locations": {
    title: "Stock locations",
    path: `/v1/inventory/locations?branchId=${branch}`,
    kind: "location",
  },
  "/admin/inventory/stock": {
    title: "Stock availability",
    path: `/v1/inventory/stock?branchId=${branch}`,
    kind: "stock",
  },
  "/admin/inventory/lots": {
    title: "Lot and expiry view",
    path: `/v1/inventory/stock?branchId=${branch}`,
    kind: "stock",
  },
  "/admin/inventory/alerts": {
    title: "Inventory alerts",
    path: `/v1/inventory/alerts?branchId=${branch}`,
    kind: "alert",
  },
  "/admin/inventory/suppliers": {
    title: "Suppliers",
    path: "/v1/inventory/suppliers",
    kind: "supplier",
  },
  "/admin/inventory/purchase-orders": {
    title: "Purchase orders",
    path: `/v1/inventory/purchase-orders?branchId=${branch}`,
    kind: "po",
  },
  "/admin/inventory/receipts": {
    title: "Goods receipts",
    path: `/v1/inventory/receipts?branchId=${branch}`,
    kind: "receipt",
  },
  "/admin/inventory/transfers": {
    title: "Stock transfers",
    path: `/v1/inventory/transfers?branchId=${branch}`,
    kind: "transfer",
  },
  "/admin/inventory/adjustments": {
    title: "Stock adjustments",
    path: `/v1/inventory/adjustments?branchId=${branch}`,
    kind: "adjustment",
  },
  "/admin/inventory/counts": {
    title: "Blind stock counts",
    path: `/v1/inventory/counts?branchId=${branch}`,
    kind: "count",
  },
  "/admin/inventory/service-recipes": {
    title: "Service material recipes",
    path: `/v1/inventory/service-recipes?branchId=${branch}`,
    kind: "recipe",
  },
  "/admin/inventory/reports": {
    title: "Inventory ledger",
    path: `/v1/inventory/ledger?branchId=${branch}`,
    kind: "ledger",
  },
  "/admin/inventory/valuation": {
    title: "Inventory valuation",
    path: `/v1/inventory/reports/valuation?branchId=${branch}`,
    kind: "valuation",
  },
};
export default function Sprint9Screen({ pathname }: { pathname: string }) {
  const base =
      Object.keys(configs).find(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      ) ?? "/admin/inventory/stock",
    config = configs[base] ?? configs["/admin/inventory/stock"]!;
  return <InventoryPage {...config} />;
}
function InventoryPage({
  title,
  path,
  kind,
}: {
  title: string;
  path: string;
  kind: string;
}) {
  const value = useData(path),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(path: string, body: any = {}) {
    setBusy(true);
    setNotice("");
    try {
      await command(path, body);
      setNotice("Saved successfully. Authoritative stock has been refreshed.");
      await value.load();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        {Object.entries(configs).map(([href, c]) => (
          <a key={href} href={href}>
            {c.title}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 9 · INVENTORY OPERATIONS</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Ledger append-only · reservations · branch scope · realtime
              refetch
            </p>
          </div>
          <span className="timezone">Online commands only</span>
        </div>
        <CreateForm kind={kind} run={run} />
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <States value={value} label={title} />
        {value.state === "ready" && (
          <InventoryTable rows={value.data} kind={kind} run={run} busy={busy} />
        )}
      </section>
    </main>
  );
}
function States({
  value,
  label,
}: {
  value: ReturnType<typeof useData>;
  label: string;
}) {
  if (value.state === "ready") return null;
  if (value.state === "loading")
    return (
      <div className="skeleton" role="status">
        Loading {label}…
      </div>
    );
  if (value.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Permission denied</h2>
        <p>Cost, supplier and branch inventory access are role-scoped.</p>
      </div>
    );
  if (value.state === "empty")
    return (
      <div className="state">
        <h2>No records</h2>
        <p>Create the first record or change filters.</p>
        <button onClick={() => void value.load()}>Refresh</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>Unable to load</h2>
      <p>{value.error}</p>
      <button onClick={() => void value.load()}>Retry</button>
    </div>
  );
}
function InventoryTable({
  rows,
  kind,
  run,
  busy,
}: {
  rows: any[];
  kind: string;
  run: (p: string, b?: any) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Status / stock</th>
            <th>Detail</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.id ?? i}>
              <td>
                {x.sku ??
                  x.poNumber ??
                  x.receiptNumber ??
                  x.transfer_number ??
                  x.code ??
                  x.entryType ??
                  x.alertType ??
                  x.id}
              </td>
              <td>
                <span className="pill">
                  {x.status ?? x.available ?? x.onHand ?? "ACTIVE"}
                </span>
              </td>
              <td>
                {x.name?.["vi-VN"] ??
                  x.name ??
                  x.quantityDelta ??
                  x.totalCostMinor ??
                  x.detectedAt ??
                  x.createdAt ??
                  "—"}
              </td>
              <td>
                <Actions x={x} kind={kind} run={run} busy={busy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Actions({
  x,
  kind,
  run,
  busy,
}: {
  x: any;
  kind: string;
  run: (p: string, b?: any) => Promise<void>;
  busy: boolean;
}) {
  if (kind === "po")
    return (
      <div className="action-row">
        {x.status === "DRAFT" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/purchase-orders/${x.id}/submit`, {
                version: x.version,
              })
            }
          >
            Submit
          </button>
        )}
        {x.status === "SUBMITTED" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/purchase-orders/${x.id}/approve`, {
                version: x.version,
              })
            }
          >
            Approve
          </button>
        )}
      </div>
    );
  if (kind === "receipt" && x.status === "DRAFT")
    return (
      <button
        disabled={busy}
        onClick={() =>
          void run(`/v1/inventory/goods-receipts/${x.id}/post`, {
            version: x.version,
          })
        }
      >
        Post
      </button>
    );
  if (kind === "transfer")
    return (
      <div className="action-row">
        {x.status === "DRAFT" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/transfers/${x.id}/request`, {
                version: x.version,
              })
            }
          >
            Request
          </button>
        )}
        {x.status === "REQUESTED" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/transfers/${x.id}/approve`, {
                version: x.version,
              })
            }
          >
            Approve
          </button>
        )}
        {x.status === "APPROVED" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/transfers/${x.id}/ship`, {
                version: x.version,
              })
            }
          >
            Ship
          </button>
        )}
        {x.status === "IN_TRANSIT" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/transfers/${x.id}/receive`, {
                version: x.version,
              })
            }
          >
            Receive
          </button>
        )}
      </div>
    );
  if (kind === "adjustment" && x.status === "PENDING")
    return (
      <button
        disabled={busy}
        onClick={() =>
          void run(`/v1/inventory/adjustments/${x.id}/approve`, {
            version: x.version,
            reason: "Approved after evidence review",
          })
        }
      >
        Approve
      </button>
    );
  if (kind === "adjustment" && x.status === "APPROVED")
    return (
      <button
        disabled={busy}
        onClick={() =>
          void run(`/v1/inventory/adjustments/${x.id}/post`, {
            version: x.version,
          })
        }
      >
        Post
      </button>
    );
  if (kind === "count")
    return (
      <div className="action-row">
        {x.status === "DRAFT" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/counts/${x.id}/start`, {
                version: x.version,
              })
            }
          >
            Start blind count
          </button>
        )}
        {x.status === "COUNTING" && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/counts/${x.id}/start-review`, {
                version: x.version,
              })
            }
          >
            Start review
          </button>
        )}
        {["REVIEW", "APPROVED"].includes(x.status) && (
          <button
            disabled={busy}
            onClick={() =>
              void run(`/v1/inventory/counts/${x.id}/post`, {
                version: x.version,
              })
            }
          >
            Post
          </button>
        )}
      </div>
    );
  if (kind === "alert" && x.status === "OPEN")
    return (
      <button
        onClick={() => void run(`/v1/inventory/alerts/${x.id}/acknowledge`)}
      >
        Acknowledge
      </button>
    );
  return <span>View</span>;
}
function CreateForm({
  kind,
  run,
}: {
  kind: string;
  run: (p: string, b: any) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    title = useMemo(
      () =>
        (
          ({
            item: "New item",
            location: "New location",
            supplier: "New supplier",
            po: "New purchase order",
            receipt: "New receipt",
            transfer: "New transfer",
            adjustment: "New adjustment",
            count: "New blind count",
            recipe: "New recipe",
          }) as any
        )[kind],
      [kind],
    );
  if (!title) return null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      v = (n: string) => String(f.get(n) ?? "").trim();
    if (kind === "item")
      await run("/v1/inventory/items", {
        baseUomId: v("uom"),
        sku: v("sku"),
        name: { "vi-VN": v("name"), "en-US": v("name") },
        itemType: v("type") || "CONSUMABLE",
        trackLot: true,
        trackExpiry: true,
        quantityPrecision: 3,
        currency: "VND",
        retailPriceMinor: v("price") || null,
        barcodes: v("barcode") ? [v("barcode")] : [],
      });
    if (kind === "location")
      await run("/v1/inventory/locations", {
        branchId: branch,
        code: v("code"),
        name: v("name"),
        locationType: "STOCKROOM",
      });
    if (kind === "supplier")
      await run("/v1/inventory/suppliers", {
        code: v("code"),
        name: v("name"),
        contact: { email: v("email") },
      });
    if (kind === "adjustment")
      await run("/v1/inventory/adjustments", {
        branchId: branch,
        locationId: v("location"),
        itemId: v("item"),
        quantityDelta: v("quantity"),
        reasonCode: "PHYSICAL_CORRECTION",
        note: v("note"),
      });
    if (kind === "po")
      await run("/v1/inventory/purchase-orders", {
        branchId: branch,
        supplierId: v("supplier"),
        currency: "VND",
        note: v("note") || undefined,
        lines: [
          {
            itemId: v("item"),
            uomId: v("uom"),
            quantity: v("quantity"),
            unitPriceMinor: v("price"),
          },
        ],
      });
    if (kind === "receipt")
      await run("/v1/inventory/receipts", {
        branchId: branch,
        purchaseOrderId: v("po") || null,
        locationId: v("location"),
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: v("poLine") || null,
            itemId: v("item"),
            lotId: v("lot") || null,
            quantity: v("quantity"),
            baseQuantity: v("quantity"),
            unitCostMinor: v("price"),
          },
        ],
      });
    if (kind === "transfer")
      await run("/v1/inventory/transfers", {
        sourceBranchId: branch,
        destinationBranchId: v("destinationBranch"),
        sourceLocationId: v("location"),
        destinationLocationId: v("destinationLocation"),
        lines: [
          {
            itemId: v("item"),
            lotId: v("lot") || null,
            quantity: v("quantity"),
          },
        ],
      });
    if (kind === "count")
      await run("/v1/inventory/counts", {
        branchId: branch,
        locationId: v("location"),
        blind: true,
        items: [{ itemId: v("item"), lotId: v("lot") || null }],
      });
    if (kind === "recipe")
      await run("/v1/inventory/service-recipes", {
        serviceId: v("service"),
        branchId: branch,
        name: v("name"),
        lines: [
          {
            itemId: v("item"),
            uomId: v("uom"),
            quantity: v("quantity"),
            allowOverride: true,
          },
        ],
      });
    setOpen(false);
  }
  return (
    <div className="toolbar">
      <button onClick={() => setOpen(!open)}>{open ? "Close" : title}</button>
      {open && (
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          {["item", "location", "supplier"].includes(kind) && (
            <label>
              Code / SKU
              <input name="code" />
              <input name="sku" />
            </label>
          )}
          {["item", "location", "supplier", "recipe"].includes(kind) && (
            <label>
              Name
              <input name="name" required />
            </label>
          )}
          {kind === "item" && (
            <>
              <label>
                Base UOM ID
                <input name="uom" required />
              </label>
              <label>
                Type
                <select name="type">
                  <option>CONSUMABLE</option>
                  <option>RETAIL</option>
                  <option>BOTH</option>
                </select>
              </label>
              <label>
                Retail price minor
                <input name="price" inputMode="numeric" />
              </label>
              <label>
                Barcode
                <input name="barcode" />
              </label>
            </>
          )}
          {kind === "supplier" && (
            <label>
              Email
              <input name="email" type="email" />
            </label>
          )}
          {kind === "adjustment" && (
            <>
              <label>
                Location ID
                <input name="location" required />
              </label>
              <label>
                Item ID
                <input name="item" required />
              </label>
              <label>
                Quantity delta
                <input name="quantity" required pattern="-?\d+(\.\d{1,6})?" />
              </label>
              <label>
                Reason
                <input name="note" required />
              </label>
            </>
          )}
          {kind === "po" && (
            <>
              <label>
                Supplier ID
                <input name="supplier" required />
              </label>
              <label>
                Item ID
                <input name="item" required />
              </label>
              <label>
                Purchase UOM ID
                <input name="uom" required />
              </label>
              <label>
                Quantity
                <input name="quantity" required pattern="\d+(\.\d{1,6})?" />
              </label>
              <label>
                Unit price minor
                <input name="price" required pattern="\d+" />
              </label>
              <label>
                Note
                <input name="note" />
              </label>
            </>
          )}
          {kind === "receipt" && (
            <>
              <label>
                Purchase order ID
                <input name="po" />
              </label>
              <label>
                PO line ID
                <input name="poLine" />
              </label>
              <label>
                Location ID
                <input name="location" required />
              </label>
              <label>
                Item ID
                <input name="item" required />
              </label>
              <label>
                Lot ID
                <input name="lot" />
              </label>
              <label>
                Quantity
                <input name="quantity" required pattern="\d+(\.\d{1,6})?" />
              </label>
              <label>
                Unit cost minor
                <input name="price" required pattern="\d+" />
              </label>
            </>
          )}
          {kind === "transfer" && (
            <>
              <label>
                Destination branch ID
                <input name="destinationBranch" required />
              </label>
              <label>
                Source location ID
                <input name="location" required />
              </label>
              <label>
                Destination location ID
                <input name="destinationLocation" required />
              </label>
              <label>
                Item ID
                <input name="item" required />
              </label>
              <label>
                Lot ID
                <input name="lot" />
              </label>
              <label>
                Quantity
                <input name="quantity" required pattern="\d+(\.\d{1,6})?" />
              </label>
            </>
          )}
          {kind === "count" && (
            <>
              <p>Expected quantities remain hidden until submission.</p>
              <label>
                Location ID
                <input name="location" required />
              </label>
              <label>
                Item ID
                <input name="item" required />
              </label>
              <label>
                Lot ID
                <input name="lot" />
              </label>
            </>
          )}
          {kind === "recipe" && (
            <>
              <label>
                Service ID
                <input name="service" required />
              </label>
              <label>
                Material item ID
                <input name="item" required />
              </label>
              <label>
                UOM ID
                <input name="uom" required />
              </label>
              <label>
                Quantity
                <input name="quantity" required pattern="\d+(\.\d{1,6})?" />
              </label>
            </>
          )}
          <button type="submit">Save</button>
        </form>
      )}
    </div>
  );
}
