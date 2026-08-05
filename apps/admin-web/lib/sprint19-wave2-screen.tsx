/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch, getActiveBranchId, setActiveBranchId } from "./auth";

type RemoteState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline" | "stale";
type RemoteValue = { state: RemoteState; data: any; error: string; code: string | undefined; load: () => Promise<void> };

function unwrap(body: any): any {
  return body?.data ?? body;
}

function errorFrom(body: any, fallback = "The request could not be completed.") {
  return body?.error?.message ?? body?.message ?? fallback;
}

async function read(path: string, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw Object.assign(new Error("Internet connection required."), { offline: true });
  }
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Your role or branch scope does not allow this view."), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(errorFrom(body)), { code: body?.error?.code, status: response.status });
  }
  return unwrap(body);
}

async function command(path: string, body: unknown) {
  return read(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

function useRemote(path: string | null): RemoteValue {
  const [state, setState] = useState<RemoteState>(path ? "loading" : "empty");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [code, setCode] = useState<string>();
  const load = useCallback(async () => {
    if (!path) {
      setState("empty");
      return;
    }
    setState("loading");
    setError("");
    setCode(undefined);
    try {
      const value = await read(path);
      setData(value);
      const empty = Array.isArray(value) ? value.length === 0 : value == null;
      setState(empty ? "empty" : "ready");
    } catch (reason: any) {
      setError(reason?.message ?? "Unable to load data.");
      setCode(reason?.code);
      setState(reason?.offline ? "offline" : reason?.forbidden ? "forbidden" : "error");
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { if (state === "offline") void load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, state]);
  return { state, data, error, code, load };
}

function money(value: any, currency = "VND") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(number / (currency === "VND" ? 1 : 100));
}

function label(value: any, fallback = "—") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  return value?.["vi-VN"] ?? value?.["en-US"] ?? value?.name ?? fallback;
}

function statusTone(value: any) {
  const status = String(value ?? "").toUpperCase();
  if (["PAID", "SUCCEEDED", "COMPLETED", "CLOSED", "APPROVED", "ACTIVE"].includes(status)) return "success";
  if (["FAILED", "REJECTED", "VOID", "CANCELLED", "UNKNOWN"].includes(status)) return "danger";
  if (["PENDING", "PROCESSING", "DRAFT", "OPEN", "PARTIALLY_PAID"].includes(status)) return "warning";
  return "info";
}

function Status({ value }: { value: any }) {
  return <span className={`w2-status w2-status-${statusTone(value)}`}>{String(value ?? "UNKNOWN").replaceAll("_", " ")}</span>;
}

function AsyncPanel({ value, label: title }: { value: RemoteValue; label: string }) {
  if (value.state === "ready") return null;
  if (value.state === "loading") return <div className="w2-state" role="status" aria-live="polite"><span className="w2-spinner" /> Loading {title}…</div>;
  if (value.state === "forbidden") return <div className="w2-state w2-state-danger" role="alert"><h2 className="w2-state-heading">Permission denied</h2><span>This view is outside your current role or branch scope.</span></div>;
  if (value.state === "offline") return <div className="w2-state w2-state-warning" role="alert"><strong>Internet connection required</strong><span>Financial commands stay online-only. Retry when connected.</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Retry</button></div>;
  if (value.state === "empty") return <div className="w2-state" role="status"><strong>No {title}</strong><span>There is nothing to show for this branch yet.</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Refresh</button></div>;
  return <div className="w2-state w2-state-danger" role="alert"><strong>{value.code === "VERSION_CONFLICT" ? "Version conflict" : "Unable to load"}</strong><span>{value.error}</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Retry</button></div>;
}

function Page({ title, eyebrow, description, children, actions }: { title: string; eyebrow: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return <main className="w2-page"><nav className="w2-subnav" aria-label="POS and finance"><a className="w2-subnav-brand" href="/admin/pos">Nailsoft POS</a><a href="/admin/pos">Overview</a><a href="/admin/pos/orders">Orders</a><a href="/admin/pos/registers">Registers</a><a href="/admin/financial/invoices">Invoices</a><a href="/admin/refunds">Refunds</a><a href="/admin/credit-notes">Credit notes</a></nav><header className="w2-page-head"><div><p className="w2-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="w2-actions">{actions}</div>}</header>{children}</main>;
}

function useBranch() {
  const branches = useRemote("/v1/branches");
  const [id, setId] = useState(getActiveBranchId() ?? "");
  useEffect(() => {
    if (!id && Array.isArray(branches.data) && branches.data[0]?.id) {
      setId(branches.data[0].id);
      setActiveBranchId(branches.data[0].id);
    }
  }, [branches.data, id]);
  const set = (next: string) => { setId(next); setActiveBranchId(next || undefined); };
  return { branches, id, set };
}

function BranchSelect({ branch }: { branch: ReturnType<typeof useBranch> }) {
  return <label className="w2-field"><span>Working branch</span><select value={branch.id} onChange={(e) => branch.set(e.target.value)}><option value="">Select branch</option>{(Array.isArray(branch.branches.data) ? branch.branches.data : []).map((item: any) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{label(item.name, item.id)}</option>)}</select></label>;
}

function Kpi({ label: title, value, detail, emphasis = false }: { label: string; value: ReactNode; detail?: string; emphasis?: boolean }) {
  return <article className={`w2-kpi ${emphasis ? "w2-kpi-emphasis" : ""}`}><span>{title}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function PosHome() {
  const branch = useBranch();
  const summary = useRemote(branch.id ? `/v1/financial/summary?branchId=${branch.id}` : null);
  const orders = useRemote(branch.id ? `/v1/pos-orders?branchId=${branch.id}` : null);
  const sessions = useRemote(branch.id ? `/v1/cash-sessions?branchId=${branch.id}&status=OPEN` : null);
  const totals = summary.data?.totals ?? summary.data ?? {};
  const openOrders = Array.isArray(orders.data) ? orders.data.filter((row: any) => ["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(row.status)) : [];
  return <Page title="Front desk control centre" eyebrow="POS · TODAY" description="A clear, server-backed view of sales, payment readiness and the register context for this branch." actions={<><a className="w2-button w2-button-primary" href="/admin/pos/new">New sale</a><a className="w2-button w2-button-secondary" href="/admin/pos/cash-sessions/open">Open register</a></>}><section className="w2-toolbar"><BranchSelect branch={branch} /><span className="w2-live"><span /> Live branch context</span></section><AsyncPanel value={summary} label="financial summary" />{summary.state === "ready" && <section className="w2-kpi-grid"><Kpi label="Today sales" value={money(totals.todaySalesMinor ?? 0, totals.currency ?? "VND")} emphasis /><Kpi label="Open orders" value={openOrders.length} detail="Draft or awaiting payment" /><Kpi label="Paid orders" value={totals.paidOrders ?? 0} /><Kpi label="Tips" value={money(totals.tipsMinor ?? 0, totals.currency ?? "VND")} /></section>}<section className="w2-dashboard-grid"><div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">OPEN WORK</p><h2>Orders to resume</h2></div><a href="/admin/pos/orders">View all</a></div><AsyncPanel value={orders} label="orders" />{orders.state === "ready" && (openOrders.length ? <div className="w2-list">{openOrders.slice(0, 6).map((row: any) => <a className="w2-list-row" href={`/admin/pos/orders/${row.id}`} key={row.id}><span><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName ?? row.customer?.displayName, "Guest sale")} · {row.status}</small></span><b>{money(row.amountDueMinor ?? row.totalMinor ?? 0, row.currency)}</b></a>)}</div> : <div className="w2-empty">No open orders. Start a new sale when a guest is ready.</div>)}</div><div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">REGISTER CONTEXT</p><h2>Open cash session</h2></div><a href="/admin/pos/registers">Manage registers</a></div><AsyncPanel value={sessions} label="open cash session" />{sessions.state === "ready" && (sessions.data.length ? <div className="w2-list">{sessions.data.slice(0, 4).map((row: any) => <a className="w2-list-row" href={`/admin/pos/cash-sessions/${row.id}`} key={row.id}><span><strong>{row.registerCode ?? row.registerId ?? "Register"}</strong><small>{row.cashierName ?? row.cashierUserId ?? "Assigned operator"} · {row.status}</small></span><b>{row.blindCount ? "Blind count" : money(row.expectedCashMinor, row.currency)}</b></a>)}</div> : <div className="w2-empty"><strong>Register not open</strong><span>Open a session before collecting cash.</span><a className="w2-button w2-button-primary" href="/admin/pos/cash-sessions/open">Open register</a></div>)}</div></section></Page>;
}

function Orders() {
  const branch = useBranch();
  const remote = useRemote(branch.id ? `/v1/pos-orders?branchId=${branch.id}` : null);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (Array.isArray(remote.data) ? remote.data : []).filter((row: any) => `${row.orderNumber ?? ""} ${row.id ?? ""} ${row.status ?? ""}`.toLowerCase().includes(query.toLowerCase())), [remote.data, query]);
  return <Page title="Open and held orders" eyebrow="POS · ORDERS" description="Resume work in this branch without losing the server version or payment evidence." actions={<a className="w2-button w2-button-primary" href="/admin/pos/new">New sale</a>}><section className="w2-toolbar"><BranchSelect branch={branch} /><label className="w2-field w2-search"><span>Search order or reference</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="POS-2026…" /></label></section><AsyncPanel value={remote} label="orders" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Order</th><th>Status</th><th>Branch</th><th>Amount due</th><th>Version</th><th /></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName, "Guest sale")}</small></td><td><Status value={row.status} /></td><td>{row.branchCode ?? row.branchId}</td><td className="w2-money">{money(row.amountDueMinor ?? 0, row.currency)}</td><td>{row.version ?? "—"}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/orders/${row.id}`}>Resume</a></td></tr>)}</tbody></table>{!rows.length && <div className="w2-empty">No order matches this search.</div>}</div>}</Page>;
}

function NewSale({ appointmentId }: { appointmentId?: string }) {
  const [appointment, setAppointment] = useState<any>();
  const [input, setInput] = useState(appointmentId ?? "");
  const [order, setOrder] = useState<any>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const appointmentRemote = useRemote(appointmentId ? `/v1/appointments/${appointmentId}` : null);
  useEffect(() => { if (appointmentRemote.state === "ready") setAppointment(appointmentRemote.data); }, [appointmentRemote.data, appointmentRemote.state]);
  async function loadAppointment(event: FormEvent) {
    event.preventDefault();
    setNotice(""); setError("");
    try { setAppointment(await read(`/v1/appointments/${input.trim()}`)); } catch (reason: any) { setError(reason.message); }
  }
  async function createOrder() {
    if (!input.trim()) return;
    setNotice(""); setError("");
    try { setOrder(await command(`/v1/appointments/${input.trim()}/pos-orders`, {})); setNotice("Order opened from the immutable appointment service snapshots."); } catch (reason: any) { setError(reason.message); }
  }
  if (order) return <OrderWorkspace orderId={order.id} />;
  return <Page title="New sale workspace" eyebrow="POS · SALE" description="Link a completed appointment to a server-calculated order. Guest checkout remains available where the existing contract allows it."><ol className="w2-stepper"><li className="is-active"><b>1</b><span>Link source</span></li><li><b>2</b><span>Build cart</span></li><li><b>3</b><span>Checkout</span></li></ol><div className="w2-sale-grid"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">APPOINTMENT OR SERVICE SESSION</p><h2>Choose a source</h2></div></div><form className="w2-form" onSubmit={(event) => void loadAppointment(event)}><label className="w2-field"><span>Appointment ID</span><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste appointment ID" required /><small>Final totals are always returned by the API; this screen never calculates authoritative money.</small></label><div className="w2-actions"><button className="w2-button w2-button-secondary" type="submit">Review appointment</button><button className="w2-button w2-button-primary" type="button" onClick={() => void createOrder()} disabled={!appointment}>Create or open order</button></div></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{notice && <div className="w2-notice w2-notice-success" role="status">{notice}</div>}{appointment && <div className="w2-source-card"><div><span className="w2-eyebrow">SOURCE READY</span><strong>{appointment.bookingReference ?? appointment.id}</strong><small>{label(appointment.contact?.displayName ?? appointment.customer?.displayName, "Guest customer")}</small></div><Status value={appointment.status} /><dl><div><dt>Checkout ready</dt><dd>{appointment.checkoutReady ? "Yes" : "Not yet"}</dd></div><div><dt>Services</dt><dd>{appointment.items?.length ?? appointment.serviceItems?.length ?? "—"}</dd></div></dl></div>}</section><aside className="w2-card w2-guidance"><p className="w2-eyebrow">OPERATOR GUIDANCE</p><h2>Fast, safe checkout</h2><ul><li>Use the branch register assigned to this device.</li><li>Approval-required discounts remain pending until a manager acts.</li><li>Every command is idempotent and refetches server totals.</li></ul></aside></div></Page>;
}

function OrderWorkspace({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const registers = useRemote("/v1/pos-registers");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function mutate(path: string, body: any, success: string): Promise<any> {
    if (!order.data) return;
    setSaving(true); setNotice(""); setError("");
    try { const result = await command(path, body); setNotice(success); await order.load(); return result; } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Version conflict: the order changed elsewhere. It has been refreshed." : reason.message); await order.load(); return undefined; } finally { setSaving(false); }
  }
  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate(`/v1/pos-orders/${orderId}/lines`, { version: order.data.version, lineType: String(form.get("lineType")), description: String(form.get("description")), quantity: Number(form.get("quantity")), unitPriceMinor: Number(form.get("unitPriceMinor")), reasonCode: "FRONT_DESK_SALE" }, "Line added and totals refreshed.");
    event.currentTarget.reset();
  }
  async function discount(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await mutate(`/v1/pos-orders/${orderId}/discounts`, { version: order.data.version, discountType: String(form.get("discountType")), value: Number(form.get("value")), reasonCode: String(form.get("reason")), note: String(form.get("note") ?? "") }, ""); if (result?.approvalRequired) setNotice(`Manager approval required: ${result.approvalRequestId}`); else if (result) setNotice("Discount applied."); }
  async function tip(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const amount = Number(new FormData(event.currentTarget).get("amountMinor")); await mutate(`/v1/pos-orders/${orderId}/tip`, { version: order.data.version, amountMinor: amount, source: "CASHIER_ENTRY", allocationBasis: "WORK_SECONDS" }, "Tip allocated from actual work segments."); }
  async function assign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const registerId = String(new FormData(event.currentTarget).get("registerId")); await mutate(`/v1/pos-orders/${orderId}/assign-register`, { version: order.data.version, registerId }, "Register assigned."); }
  if (order.state !== "ready") return <Page title="Sale workspace" eyebrow="POS · ORDER"><AsyncPanel value={order} label="order" /></Page>;
  const row = order.data;
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return <Page title="Order detail" eyebrow="POS · SALE WORKSPACE" description="Build the cart on the left, keep the authoritative order summary visible, and move to payment only when the register and approval guards pass." actions={<a className="w2-button w2-button-secondary" href="/admin/pos/orders">Back to orders</a>}><div className="w2-order-context"><span><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName ?? row.customer?.displayName, "Guest sale")} · {row.branchCode ?? row.branchId} · {row.status} · version {row.version}</small></span><Status value={row.status} /></div>{notice && <div className="w2-notice w2-notice-success" role="status">{notice}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<div className="w2-sale-grid w2-sale-grid-wide"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">CART LINES</p><h2>Services and retail</h2></div><span className="w2-muted">{lines.length} line{lines.length === 1 ? "" : "s"}</span></div>{lines.length ? <ul className="w2-line-list">{lines.map((line: any) => <li key={line.id}><div><strong>{label(line.description?.name ?? line.description, "Sale line")}</strong><small>{line.lineType ?? line.sourceSnapshot?.reasonCode ?? "Service"} · qty {line.quantity}</small></div><b>{money(line.netMinor ?? line.grossMinor, row.currency)}</b></li>)}</ul> : <div className="w2-empty">Cart is empty. Add a service or retail line to continue.</div>}{row.status === "DRAFT" && <form className="w2-inline-form" onSubmit={(event) => void addLine(event)}><input name="description" aria-label="Line description" placeholder="Add a service or retail item" required /><select name="lineType" aria-label="Line type"><option value="MANUAL_SERVICE">Service</option><option value="ADJUSTMENT">Retail / adjustment</option></select><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" aria-label="Quantity" required /><input name="unitPriceMinor" type="number" min="0" placeholder="Unit price" aria-label="Unit price in minor units" required /><button className="w2-button w2-button-primary" disabled={saving}>Add line</button></form>}</section><aside className="w2-card w2-summary-card"><p className="w2-eyebrow">SERVER TOTALS</p><h2>Order summary</h2><dl className="w2-totals"><div><dt>Subtotal</dt><dd>{money(row.subtotalMinor, row.currency)}</dd></div><div><dt>Discount</dt><dd>−{money(row.discountMinor, row.currency)}</dd></div><div><dt>Tax</dt><dd>{money(row.taxMinor, row.currency)}</dd></div><div><dt>Tip</dt><dd>{money(row.tipMinor, row.currency)}</dd></div><div className="w2-total"><dt>Amount due</dt><dd>{money(row.amountDueMinor, row.currency)}</dd></div></dl>{row.status === "DRAFT" && <><form className="w2-stack-form" onSubmit={(event) => void assign(event)}><label className="w2-field"><span>Register</span><select name="registerId" defaultValue={row.registerId ?? ""} required><option value="">Select active register</option>{(Array.isArray(registers.data) ? registers.data : []).filter((item: any) => item.status === "ACTIVE" && item.branchId === row.branchId).map((item: any) => <option key={item.id} value={item.id}>{item.code ?? item.name ?? item.id}</option>)}</select></label><button className="w2-button w2-button-secondary" disabled={saving}>Assign register</button></form><button className="w2-button w2-button-primary w2-full" disabled={saving || !row.registerId || !lines.length} onClick={() => void mutate(`/v1/pos-orders/${orderId}/finalize`, { version: row.version }, "Order finalized. Pricing is now immutable.")}>Finalize order</button></>}{["READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(row.status) && <a className="w2-button w2-button-primary w2-full" href={`/admin/pos/orders/${orderId}/payment`}>Collect payment</a>}{row.status === "PAID" && <a className="w2-button w2-button-primary w2-full" href={`/admin/pos/orders/${orderId}/receipt`}>Open immutable receipt</a>}</aside></div>{row.status === "DRAFT" && <section className="w2-action-grid"><form className="w2-card w2-stack-form" onSubmit={(event) => void discount(event)}><div><p className="w2-eyebrow">APPROVAL</p><h2>Discount</h2></div><label className="w2-field"><span>Type</span><select name="discountType"><option value="FIXED">Fixed minor units</option><option value="PERCENT">Percentage basis points</option></select></label><label className="w2-field"><span>Value</span><input name="value" type="number" min="0" required /></label><label className="w2-field"><span>Reason</span><input name="reason" defaultValue="CUSTOMER_CARE" required /></label><label className="w2-field"><span>Operator note</span><textarea name="note" /></label><button className="w2-button w2-button-secondary" disabled={saving}>Apply / request approval</button></form><form className="w2-card w2-stack-form" onSubmit={(event) => void tip(event)}><div><p className="w2-eyebrow">TIP</p><h2>Tip</h2></div><label className="w2-field"><span>Tip amount in minor units</span><input name="amountMinor" type="number" min="0" required /></label><small className="w2-muted">Allocation uses actual work segments from the service execution history.</small><button className="w2-button w2-button-secondary" disabled={saving}>Set and allocate tip</button></form></section>}</Page>;
}

function Payment({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const sessions = useRemote("/v1/cash-sessions?status=OPEN");
  const [tender, setTender] = useState("CASH");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!order.data) return;
    const form = new FormData(event.currentTarget); const amount = Number(form.get("amountToApplyMinor"));
    const body: any = { version: order.data.version, tenderType: tender, amountToApplyMinor: amount };
    if (tender === "CASH") Object.assign(body, { cashReceivedMinor: Number(form.get("cashReceivedMinor")), cashSessionId: String(form.get("cashSessionId")) });
    if (tender === "CARD_EXTERNAL") Object.assign(body, { provider: "manual-terminal", providerTransactionId: String(form.get("reference")), cardLast4: String(form.get("last4") || "") || undefined });
    if (tender === "BANK_TRANSFER") Object.assign(body, { providerTransactionId: String(form.get("reference")), receivedAt: new Date().toISOString(), evidenceNote: "Verified by cashier" });
    setSubmitting(true); setMessage(""); setError("");
    try { const result = await command(`/v1/pos-orders/${orderId}/payments`, body); const status = result?.status ?? result?.payment?.status ?? "RECORDED"; setMessage(tender === "CARD_EXTERNAL" ? "External payment evidence recorded." : `Payment response received: ${status}. Totals were refreshed from the server.`); await order.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Version conflict: payment was not submitted. The current order is loaded." : reason.message); await order.load(); } finally { setSubmitting(false); }
  }
  if (order.state !== "ready") return <Page title="Checkout" eyebrow="POS · PAYMENT"><AsyncPanel value={order} label="order" /></Page>;
  const row = order.data;
  return <Page title="Collect payment" eyebrow="POS · CHECKOUT" description="Choose one supported tender at a time. The server confirms the final allocation and amount due after every capture." actions={<a className="w2-button w2-button-secondary" href={`/admin/pos/orders/${orderId}`}>Back to order</a>}><div className="w2-checkout-layout"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">FINAL REVIEW</p><h2>{row.orderNumber}</h2><p className="w2-muted">{label(row.customerSnapshot?.displayName, "Guest sale")} · {row.branchCode ?? row.branchId}</p></div><Status value={row.status} /></div><dl className="w2-totals w2-totals-large"><div><dt>Total</dt><dd>{money(row.totalMinor, row.currency)}</dd></div><div><dt>Already paid</dt><dd>{money(row.paidMinor, row.currency)}</dd></div><div className="w2-total"><dt>Remaining</dt><dd>{money(row.amountDueMinor, row.currency)}</dd></div></dl><h3>Captured tenders</h3><div className="w2-list">{(row.payments ?? []).length ? row.payments.map((payment: any) => <div className="w2-list-row" key={payment.id}><span><strong>{payment.tenderType}</strong><small>{payment.providerTransactionId ?? payment.id} · {payment.status}</small></span><b>{money(payment.capturedMinor ?? payment.amountMinor, payment.currency ?? row.currency)}</b></div>) : <div className="w2-empty">No payment captured yet.</div>}</div></section><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">PAYMENT ACTION</p><h2>Collect remaining amount</h2></div><span className="w2-protection">Idempotent</span></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{row.amountDueMinor > 0 ? <form className="w2-stack-form" onSubmit={(event) => void submit(event)}><label className="w2-field"><span>Tender</span><select value={tender} onChange={(e) => setTender(e.target.value)}><option value="CASH">Cash</option><option value="CARD_EXTERNAL">External card terminal</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER_EXTERNAL">Other supported external tender</option></select></label><label className="w2-field"><span>Amount to apply (minor units)</span><input name="amountToApplyMinor" type="number" min="1" max={row.amountDueMinor} defaultValue={row.amountDueMinor} required /></label>{tender === "CASH" && <><label className="w2-field"><span>Cash received</span><input name="cashReceivedMinor" type="number" min="1" defaultValue={row.amountDueMinor} required /></label><label className="w2-field"><span>Open cash session</span><select name="cashSessionId" required><option value="">Select session</option>{(Array.isArray(sessions.data) ? sessions.data : []).map((session: any) => <option key={session.id} value={session.id}>{session.registerCode ?? session.registerId} · {session.cashierName ?? session.cashierUserId}</option>)}</select></label></>}{tender !== "CASH" && <label className="w2-field"><span>External reference</span><input name="reference" required /></label>}{tender === "CARD_EXTERNAL" && <label className="w2-field"><span>Card last 4 only</span><input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} /></label>}<button className="w2-button w2-button-primary w2-full" disabled={submitting}>{submitting ? "Submitting…" : "Capture once"}</button><p className="w2-helper">If the provider returns UNKNOWN, do not retry blindly. Recheck the payment status before a new attempt.</p></form> : <div className="w2-notice w2-notice-success" role="status">The order is fully paid. Open the immutable receipt.</div>}</section></div></Page>;
}

function Receipt({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const invoiceId = order.state === "ready" ? order.data?.invoice?.id ?? order.data?.invoiceId : null;
  const receipt = useRemote(invoiceId ? `/v1/invoices/${invoiceId}/print` : null);
  return <Page title="Receipt" eyebrow="POS · RECEIPT" description="Issued invoice and payment evidence are read-only. Corrections go through refund or credit-note flows." actions={<a className="w2-button w2-button-secondary" href={`/admin/pos/orders/${orderId}`}>Back to order</a>}><AsyncPanel value={order} label="paid order" />{order.state === "ready" && !invoiceId && <div className="w2-state w2-state-warning" role="alert"><strong>Invoice is not issued.</strong><span>The server has not confirmed a finalized invoice for this order.</span></div>}{invoiceId && <AsyncPanel value={receipt} label="receipt" />}{receipt.state === "ready" && <div className="w2-card w2-receipt-card"><div><p className="w2-eyebrow">INVOICE</p><h2>{receipt.data.invoiceNumber ?? invoiceId}</h2><p>{label(receipt.data.branchSnapshot?.name ?? order.data?.branchCode, "Branch")} · {receipt.data.issuedAt ?? "Issued by server"}</p></div><div className="w2-receipt-total">{money(receipt.data.totalMinor, receipt.data.currency)}</div><dl className="w2-totals"><div><dt>Paid</dt><dd>{money(receipt.data.paidMinor, receipt.data.currency)}</dd></div><div><dt>Tip</dt><dd>{money(receipt.data.tipMinor, receipt.data.currency)}</dd></div><div><dt>Payment status</dt><dd><Status value="PAID" /></dd></div></dl><button className="w2-button w2-button-primary" onClick={() => window.print()}>Print receipt</button><small className="w2-helper">Verify {receipt.data.verificationCode ?? "immutable evidence"}</small></div>}</Page>;
}

function Registers() {
  const branch = useBranch(); const remote = useRemote(branch.id ? `/v1/pos-registers?branchId=${branch.id}` : "/v1/pos-registers");
  return <Page title="Registers and drawers" eyebrow="CASH · REGISTERS" description="Confirm branch, device and operator scope before opening a drawer." actions={<a className="w2-button w2-button-primary" href="/admin/pos/cash-sessions/open">Open register</a>}><section className="w2-toolbar"><BranchSelect branch={branch} /></section><AsyncPanel value={remote} label="registers" />{remote.state === "ready" && <div className="w2-card-grid">{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <article className="w2-card w2-register-card" key={row.id}><div className="w2-card-head"><div><p className="w2-eyebrow">REGISTER</p><h2>{row.code ?? row.name ?? row.id}</h2></div><Status value={row.status} /></div><dl className="w2-summary"><div><dt>Branch</dt><dd>{row.branchCode ?? row.branchId}</dd></div><div><dt>Drawer</dt><dd>{(row.drawers ?? []).map((drawer: any) => drawer.code ?? drawer.name ?? drawer.id).join(" · ") || "No drawer assigned"}</dd></div><div><dt>Device</dt><dd>{row.deviceId ?? "Bound by policy"}</dd></div><div><dt>Operator</dt><dd>{row.assignedUserName ?? row.assignedUserId ?? "Not assigned"}</dd></div></dl></article>)}</div>}</Page>;
}

function OpenRegister() {
  const registers = useRemote("/v1/pos-registers"); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError(""); setMessage(""); try { await command("/v1/cash-sessions/open", { registerId: String(form.get("registerId")), cashDrawerId: String(form.get("cashDrawerId")), openingFloatMinor: Number(form.get("openingFloatMinor")), deviceId: String(form.get("deviceId") || "admin-web") }); setMessage("Register session opened. Return to the POS overview to verify the active context."); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } }
  return <Page title="Open register session" eyebrow="CASH · OPEN" description="Opening a drawer is a guarded, idempotent command tied to the assigned device and branch."><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">REGISTER ASSIGNMENT</p><h2>Opening float</h2></div></div><AsyncPanel value={registers} label="registers" /><form className="w2-stack-form" onSubmit={(event) => void submit(event)}><label className="w2-field"><span>Register</span><select name="registerId" required><option value="">Select register</option>{(Array.isArray(registers.data) ? registers.data : []).filter((row: any) => row.status === "ACTIVE").map((row: any) => <option key={row.id} value={row.id}>{row.code ?? row.name ?? row.id}</option>)}</select></label><label className="w2-field"><span>Cash drawer ID</span><input name="cashDrawerId" required /></label><label className="w2-field"><span>Opening float (minor units)</span><input name="openingFloatMinor" type="number" min="0" required /></label><label className="w2-field"><span>Device</span><input name="deviceId" defaultValue="admin-web" /></label><button className="w2-button w2-button-primary" disabled={saving}>{saving ? "Opening…" : "Open register"}</button></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}</section><aside className="w2-card w2-guidance"><p className="w2-eyebrow">GUARDS</p><h2>Before you open</h2><ul><li>Register must be active and in the current branch.</li><li>Device binding and operator ownership remain server-enforced.</li><li>Opening twice is blocked by the cash-session invariant.</li></ul></aside></div></Page>;
}

function CashSessions() { const branch = useBranch(); const remote = useRemote(branch.id ? `/v1/cash-sessions?branchId=${branch.id}` : null); return <Page title="Cash sessions" eyebrow="CASH · HISTORY" description="Open, closing and closed sessions remain attributable to their operator and register."><section className="w2-toolbar"><BranchSelect branch={branch} /></section><AsyncPanel value={remote} label="cash sessions" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Register</th><th>Operator</th><th>Status</th><th>Expected cash</th><th>Opened</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.registerCode ?? row.registerId}</strong><small>{row.branchCode ?? row.branchId}</small></td><td>{row.cashierName ?? row.cashierUserId}</td><td><Status value={row.status} /></td><td>{row.blindCount ? "Hidden until count" : money(row.expectedCashMinor, row.currency)}</td><td>{row.openedAt ? new Date(row.openedAt).toLocaleString("vi-VN") : "—"}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/cash-sessions/${row.id}`}>Open</a></td></tr>)}</tbody></table></div>}</Page>; }

function CashSession({ sessionId, close = false }: { sessionId: string; close?: boolean }) {
  const value = useRemote(`/v1/cash-sessions/${sessionId}`); const movements = useRemote(`/v1/cash-sessions/${sessionId}/movements`); const review = useRemote(close ? `/v1/cash-sessions/${sessionId}/closing-review` : null); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function act(path: string, body: any, success: string) { if (!value.data) return; try { await command(path, { version: value.data.version, ...body }); setMessage(success); await value.load(); await movements.load(); await review.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Version conflict: the session was refreshed." : reason.message); await value.load(); } }
  async function move(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await act(`/v1/cash-sessions/${sessionId}/movements`, { movementType: String(form.get("movementType")), amountMinor: Number(form.get("amountMinor")), reasonCode: String(form.get("reasonCode")), note: String(form.get("note") ?? "") }, "Cash movement recorded."); event.currentTarget.reset(); }
  async function declare(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const amount = Number(new FormData(event.currentTarget).get("declaredCashMinor")); await act(`/v1/cash-sessions/${sessionId}/declare`, { declaredCashMinor: amount }, "Blind count submitted for review."); }
  if (value.state !== "ready") return <Page title="Cash drawer" eyebrow="CASH · SESSION"><AsyncPanel value={value} label="cash session" /></Page>;
  const row = value.data; const items = Array.isArray(movements.data) ? movements.data : [];
  return <Page title={`Cash drawer · ${row.registerCode ?? row.registerId}`} eyebrow="CASH · DRAWER" description="Movement history is append-only. Closing is a staged workflow with blind count and variance review." actions={<a className="w2-button w2-button-secondary" href="/admin/pos/cash-sessions">Back to sessions</a>}><div className="w2-order-context"><span><strong>{row.cashierName ?? row.cashierUserId}</strong><small>{row.branchCode ?? row.branchId} · version {row.version}</small></span><Status value={row.status} /></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<section className="w2-kpi-grid"><Kpi label="Opening float" value={money(row.openingFloatMinor, row.currency)} /><Kpi label="Expected cash" value={row.blindCount ? "Hidden until count" : money(row.expectedCashMinor, row.currency)} emphasis /><Kpi label="Paid in / out" value={`${money(row.totalPaidInMinor ?? 0, row.currency)} / ${money(row.totalPaidOutMinor ?? 0, row.currency)}`} /><Kpi label="Session" value={<Status value={row.status} />} /></section><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">APPEND-ONLY MOVEMENTS</p><h2>Drawer activity</h2></div></div><AsyncPanel value={movements} label="movements" />{movements.state === "ready" && (items.length ? <div className="w2-list">{items.map((item: any) => <div className="w2-list-row" key={item.id}><span><strong>{item.movementType ?? item.type}</strong><small>{item.reasonCode} · {item.actorUserId ?? item.operatorName ?? "Operator"}</small></span><b>{money(item.amountMinor, row.currency)}</b></div>)}</div> : <div className="w2-empty">No drawer movements recorded.</div>)}{row.status === "OPEN" && <form className="w2-stack-form w2-top-gap" onSubmit={(event) => void move(event)}><h3>Record movement</h3><label className="w2-field"><span>Type</span><select name="movementType"><option value="CASH_IN">Paid in</option><option value="CASH_OUT">Paid out</option><option value="CASH_DROP">Cash drop</option></select></label><label className="w2-field"><span>Amount (minor units)</span><input name="amountMinor" type="number" min="1" required /></label><label className="w2-field"><span>Reason</span><input name="reasonCode" required /></label><label className="w2-field"><span>Note</span><textarea name="note" /></label><button className="w2-button w2-button-secondary">Record movement</button></form>}</section><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">CLOSE WORKFLOW</p><h2>{close ? "Blind count and variance" : "Session controls"}</h2></div></div>{row.status === "OPEN" && !close && <button className="w2-button w2-button-primary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/begin-closing`, {}, "Closing started. Enter the blind count next.")}>Start close</button>}{(close || ["CLOSING", "COUNTED", "VARIANCE_REVIEW"].includes(row.status)) && <><AsyncPanel value={review} label="closing review" />{review.state === "ready" && <dl className="w2-summary"><div><dt>Expected</dt><dd>{review.data.blindCount ? "Hidden" : money(review.data.expectedCashMinor, row.currency)}</dd></div><div><dt>Variance threshold</dt><dd>{money(review.data.varianceThresholdMinor ?? 0, row.currency)}</dd></div><div><dt>Approval</dt><dd><Status value={review.data.approvalStatus ?? row.status} /></dd></div></dl>}<form className="w2-stack-form w2-top-gap" onSubmit={(event) => void declare(event)}><label className="w2-field"><span>Declared cash (minor units)</span><input name="declaredCashMinor" type="number" min="0" required /></label><button className="w2-button w2-button-primary">Submit blind count</button></form><div className="w2-actions w2-top-gap"><button className="w2-button w2-button-secondary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/reopen`, {}, "Session reopened for a controlled recount.")}>Request recount / reopen</button><button className="w2-button w2-button-primary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/close`, { varianceReason: "Reviewed in register workflow" }, "Register closed with server-approved variance.")}>Final close</button></div></>}</section></div></Page>;
}

function FinancialList({ kind }: { kind: "invoices" | "payments" | "reconciliation" | "net-sales" }) {
  const paths = { invoices: "/v1/invoices", payments: "/v1/payments", reconciliation: "/v1/financial/reconciliation/daily", "net-sales": "/v1/financial/net-sales" };
  const remote = useRemote(paths[kind]); const title = kind === "net-sales" ? "Net sales" : kind.charAt(0).toUpperCase() + kind.slice(1);
  const rows = Array.isArray(remote.data) ? remote.data : remote.data?.rows ?? remote.data?.items ?? [];
  return <Page title={title} eyebrow="FINANCE · REPORTING" description="Read-only financial evidence from the existing server contract. Finalized invoices are never edited here."><AsyncPanel value={remote} label={title.toLowerCase()} />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Reference</th><th>Status</th><th>Customer / branch</th><th>Amount</th><th>Created</th><th /></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id ?? row.invoiceId ?? row.paymentId}><td><strong>{row.invoiceNumber ?? row.orderNumber ?? row.reference ?? row.id}</strong><small>{row.id}</small></td><td><Status value={row.status ?? row.paymentStatus} /></td><td>{label(row.customerSnapshot?.displayName ?? row.branchCode ?? row.branchId, "—")}</td><td className="w2-money">{money(row.totalMinor ?? row.amountMinor ?? row.netSalesMinor ?? 0, row.currency)}</td><td>{row.createdAt ? new Date(row.createdAt).toLocaleDateString("vi-VN") : "—"}</td><td>{row.invoiceId && <a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/orders/${row.posOrderId ?? row.orderId ?? ""}/receipt`}>Receipt</a>}</td></tr>)}</tbody></table></div>}</Page>;
}

function RefundCreate() {
  const [invoiceId, setInvoiceId] = useState(""); const [lineId, setLineId] = useState(""); const [amount, setAmount] = useState(""); const [tip, setTip] = useState("0"); const [reason, setReason] = useState("CUSTOMER_REQUEST"); const [preview, setPreview] = useState<any>(); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function plan(event: FormEvent) { event.preventDefault(); setError(""); setMessage(""); try { setPreview(await command(`/v1/invoices/${invoiceId}/refund-plans`, { items: [{ invoiceLineId: lineId, amountMinor: Number(amount) }], tipAmountMinor: Number(tip), refundDestination: "ORIGINAL_TENDER" })); } catch (reason: any) { setError(reason.message); } }
  async function create() { setSaving(true); try { const result = await command(`/v1/invoices/${invoiceId}/refunds`, { items: [{ invoiceLineId: lineId, amountMinor: Number(amount) }], tipAmountMinor: Number(tip), refundDestination: "ORIGINAL_TENDER", reasonCode: reason, reasonText: "Requested through refund review" }); setMessage(`Refund draft ${result.refundReference ?? result.id} created.`); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } }
  return <Page title="Refund initiation" eyebrow="CORRECTIONS · REFUND" description="Preview refundable lines and original tender allocation before creating a draft. The server remains authoritative for every amount."><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">REQUEST</p><h2>Choose refundable evidence</h2></div><span className="w2-protection">Manager review</span></div><form className="w2-stack-form" onSubmit={(event) => void plan(event)}><label className="w2-field"><span>Invoice ID</span><input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required /></label><label className="w2-field"><span>Invoice line ID</span><input value={lineId} onChange={(e) => setLineId(e.target.value)} required /></label><label className="w2-field"><span>Line amount (minor units)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" required /></label><label className="w2-field"><span>Tip reversal (minor units)</span><input value={tip} onChange={(e) => setTip(e.target.value)} type="number" min="0" /></label><label className="w2-field"><span>Reason</span><select value={reason} onChange={(e) => setReason(e.target.value)}><option>CUSTOMER_REQUEST</option><option>SERVICE_QUALITY</option><option>DUPLICATE_CHARGE</option></select></label><button className="w2-button w2-button-primary">Preview refund</button></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}</section><section className="w2-card"><p className="w2-eyebrow">AUTHORITATIVE PREVIEW</p><h2>Allocation and policy</h2>{preview ? <><dl className="w2-totals"><div><dt>Requested</dt><dd>{money(preview.requestedMinor, preview.currency)}</dd></div><div><dt>Tax reversal</dt><dd>{money(preview.taxRefundMinor, preview.currency)}</dd></div><div className="w2-total"><dt>Approval</dt><dd>{preview.approval?.required ? "Required" : "Policy allows direct path"}</dd></div></dl><p className="w2-helper">Original tender: {(preview.paymentAllocations ?? []).map((item: any) => `${item.tenderType} ${money(item.plannedMinor, preview.currency)}`).join(" · ") || "No allocation returned"}</p><button className="w2-button w2-button-primary" disabled={saving} onClick={() => void create()}>{saving ? "Creating…" : "Create refund draft"}</button></> : <div className="w2-empty">Enter invoice line evidence to see remaining refundable amount, policy window and tender allocation.</div>}</section></div></Page>;
}

function Refunds() { const remote = useRemote("/v1/refunds"); return <Page title="Refund review queue" eyebrow="CORRECTIONS · REFUNDS" description="Review requested, approved, processing and unknown refunds without hiding provider state." actions={<a className="w2-button w2-button-primary" href="/admin/refunds/new">Start refund</a>}><AsyncPanel value={remote} label="refunds" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Reference</th><th>Invoice</th><th>Status</th><th>Requested</th><th>Completed</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.refundReference ?? row.id}</strong><small>{row.reasonCode}</small></td><td>{row.invoiceNumber ?? row.invoiceId}</td><td><Status value={row.status} /></td><td className="w2-money">{money(row.requestedMinor, row.currency)}</td><td className="w2-money">{money(row.completedMinor, row.currency)}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/refunds/${row.id}`}>Review</a></td></tr>)}</tbody></table></div>}</Page>; }

function RefundDetail({ id }: { id: string }) { const value = useRemote(`/v1/refunds/${id}`); const [message, setMessage] = useState(""); const [error, setError] = useState(""); async function act(action: string, extra: any = {}) { if (!value.data) return; try { await command(`/v1/refunds/${id}/${action}`, { version: value.data.version, ...extra }); setMessage(`${action} confirmed by the server.`); await value.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Version conflict: the refund was refreshed." : reason.message); await value.load(); } } return <Page title="Refund review" eyebrow="CORRECTIONS · REVIEW" description="Inspect invoice lines, original tenders, approvals and reversal evidence before executing a refund." actions={<a className="w2-button w2-button-secondary" href="/admin/refunds">Back to queue</a>}><AsyncPanel value={value} label="refund" />{value.state === "ready" && <><div className="w2-kpi-grid"><Kpi label="Requested" value={money(value.data.requestedMinor, value.data.currency)} emphasis /><Kpi label="Completed" value={money(value.data.completedMinor, value.data.currency)} /><Kpi label="Status" value={<Status value={value.data.status} />} /><Kpi label="Invoice" value={value.data.invoiceNumber ?? value.data.invoiceId} /></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">IMMUTABLE EVIDENCE</p><h2>Lines and original tenders</h2></div><Status value={value.data.status} /></div><pre className="w2-evidence">{JSON.stringify({ items: value.data.items, paymentAllocations: value.data.paymentAllocations, tipRefundMinor: value.data.tipRefundMinor, reasonCode: value.data.reasonCode }, null, 2)}</pre><div className="w2-actions"><button className="w2-button w2-button-secondary" onClick={() => void act("submit")}>Submit</button><button className="w2-button w2-button-primary" onClick={() => void act("approve", { reason: "Evidence reviewed by manager" })}>Approve</button><button className="w2-button w2-button-danger" onClick={() => void act("reject", { reason: "Evidence requires correction" })}>Reject</button><button className="w2-button w2-button-secondary" onClick={() => void act("cancel", { reason: "Cancelled by operator" })}>Cancel</button></div></div></>}</Page>; }

function CreditNotes({ detailId }: { detailId?: string }) { const remote = useRemote(detailId ? `/v1/credit-notes/${detailId}` : "/v1/credit-notes"); if (detailId) return <Page title="Credit note detail" eyebrow="CORRECTIONS · CREDIT NOTE" description="Credit notes are immutable evidence. Delivery and application remain separate server actions." actions={<a className="w2-button w2-button-secondary" href="/admin/credit-notes">Back to credit notes</a>}><AsyncPanel value={remote} label="credit note" />{remote.state === "ready" && <div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">CREDIT NOTE</p><h2>{remote.data.creditNoteNumber ?? remote.data.id}</h2></div><Status value={remote.data.status} /></div><dl className="w2-totals"><div><dt>Invoice</dt><dd>{remote.data.invoiceNumber ?? remote.data.invoiceId}</dd></div><div><dt>Total</dt><dd>{money(remote.data.totalMinor ?? remote.data.amountMinor, remote.data.currency)}</dd></div></dl><pre className="w2-evidence">{JSON.stringify(remote.data, null, 2)}</pre><button className="w2-button w2-button-secondary" onClick={() => void command(`/v1/credit-notes/${detailId}/deliver`, { channel: "PRINT" })}>Print / deliver evidence</button></div>}</Page>;
  return <Page title="Credit notes" eyebrow="CORRECTIONS · CREDIT NOTES" description="Issued credit evidence is read-only and linked back to its invoice and refund source."><AsyncPanel value={remote} label="credit notes" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Credit note</th><th>Invoice</th><th>Status</th><th>Amount</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.creditNoteNumber ?? row.id}</strong></td><td>{row.invoiceNumber ?? row.invoiceId}</td><td><Status value={row.status} /></td><td className="w2-money">{money(row.totalMinor ?? row.amountMinor, row.currency)}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/credit-notes/${row.id}`}>Open evidence</a></td></tr>)}</tbody></table></div>}</Page>;
}

function Commission({ adjustments = false }: { adjustments?: boolean }) { const remote = useRemote(adjustments ? "/v1/commission-adjustments" : "/v1/commission-entries"); return <Page title={adjustments ? "Commission adjustments" : "Commission evidence"} eyebrow="CORRECTIONS · COMMISSION" description="View contribution and reversal evidence from the existing commission contract; no client-side recalculation is performed."><AsyncPanel value={remote} label="commission records" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Record</th><th>Staff</th><th>Status</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.entryReference ?? row.adjustmentReference ?? row.id}</strong><small>{row.ruleCode ?? row.reasonCode ?? "Evidence"}</small></td><td>{row.staffName ?? row.staffId ?? "—"}</td><td><Status value={row.status ?? row.state} /></td><td className="w2-money">{money(row.amountMinor ?? row.commissionMinor ?? row.reversalMinor, row.currency)}</td><td>{row.sourceReference ?? row.refundId ?? row.statementId ?? "—"}</td></tr>)}</tbody></table></div>}</Page>; }

export function isWave2Path(pathname: string) {
  return pathname === "/admin/pos" || pathname === "/admin/pos/new" || pathname.startsWith("/admin/pos/") || pathname === "/admin/financial" || pathname.startsWith("/admin/financial/") || pathname === "/admin/refunds" || pathname.startsWith("/admin/refunds/") || pathname === "/admin/credit-notes" || pathname.startsWith("/admin/credit-notes/") || pathname.startsWith("/admin/commission");
}

export default function Sprint19Wave2Screen({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/admin/pos" || pathname === "/admin/pos/") return <PosHome />;
  if (pathname === "/admin/pos/new") return <NewSale />;
  if (pathname.startsWith("/admin/pos/checkout/")) return <NewSale appointmentId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/orders") return <Orders />;
  if (pathname.endsWith("/payment") && pathname.startsWith("/admin/pos/orders/")) return <Payment orderId={parts[3] ?? ""} />;
  if (pathname.endsWith("/receipt") && pathname.startsWith("/admin/pos/orders/")) return <Receipt orderId={parts[3] ?? ""} />;
  if (pathname.startsWith("/admin/pos/orders/")) return <OrderWorkspace orderId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/registers") return <Registers />;
  if (pathname === "/admin/pos/cash-sessions/open") return <OpenRegister />;
  if (pathname === "/admin/pos/cash-sessions") return <CashSessions />;
  if (pathname.startsWith("/admin/pos/cash-sessions/")) return <CashSession sessionId={parts[3] ?? ""} close={pathname.endsWith("/close")} />;
  if (pathname === "/admin/financial/invoices") return <FinancialList kind="invoices" />;
  if (pathname === "/admin/financial/payments") return <FinancialList kind="payments" />;
  if (pathname === "/admin/financial/reconciliation") return <FinancialList kind="reconciliation" />;
  if (pathname === "/admin/financial/net-sales") return <FinancialList kind="net-sales" />;
  if (pathname === "/admin/refunds/new") return <RefundCreate />;
  if (pathname === "/admin/refunds") return <Refunds />;
  if (pathname.startsWith("/admin/refunds/")) return <RefundDetail id={parts[2] ?? ""} />;
  if (pathname === "/admin/credit-notes") return <CreditNotes />;
  if (pathname.startsWith("/admin/credit-notes/")) return <CreditNotes detailId={parts[2] ?? ""} />;
  if (pathname.startsWith("/admin/commission/adjustments")) return <Commission adjustments />;
  return <Commission />;
}
