/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "../auth";

type State = "loading" | "ready" | "error" | "forbidden" | "offline";

function money(value: unknown, currency = "VND") {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(currency === "VND" ? amount : amount / 100);
}

function date(value: unknown) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "-";
}

function status(value: unknown) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}

function unwrapError(body: any) {
  return body?.error?.message ?? "Unable to load the customer profile.";
}

function StatePanel({ state, error, retry }: { state: State; error: string; retry: () => void }) {
  if (state === "loading") return <div className="s19-state" role="status"><span className="s19-spinner" />Loading customer profile...</div>;
  if (state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><h2>Permission denied</h2><span>This customer profile is outside your current permission or support access scope.</span></div>;
  if (state === "offline") return <div className="s19-state" role="alert"><strong>Internet connection required</strong><span>Customer profiles are not available offline.</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Retry</button></div>;
  return <div className="s19-state s19-state-danger" role="alert"><strong>Unable to load customer profile</strong><span>{error}</span><button className="s19-button s19-button-secondary" type="button" onClick={retry}>Retry</button></div>;
}

function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return <section className="s19-card s19-customer-section"><div className="s19-card-heading"><div>{eyebrow ? <p className="s19-eyebrow">{eyebrow}</p> : null}<h2>{title}</h2></div></div>{children}</section>;
}

function Restricted({ title }: { title: string }) {
  return <div className="s19-customer-restricted" role="status"><strong>{title}</strong><span>You do not have permission to view this financial history.</span></div>;
}

export default function CustomerDetail({ customerId }: { customerId: string }) {
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) { setState("offline"); return; }
    setState("loading"); setError("");
    try {
      const response = await authorizedFetch(`/v1/customers/${encodeURIComponent(customerId)}`);
      const body = await response.json().catch(() => ({}));
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error(unwrapError(body));
      setData(body?.data); setState("ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to load customer profile.");
      setState(cause?.offline ? "offline" : "error");
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  if (state !== "ready") return <main className="s19-customer-page"><a className="s19-customer-back" href="/admin/customers">&lt;- Customers</a><StatePanel state={state} error={error} retry={() => void load()} /></main>;
  const profile = data.profile ?? {};
  const summary = data.activitySummary ?? {};
  const purchases = data.recentPurchases ?? { access: "DENIED", items: [] };
  const refunds = data.recentRefunds ?? { access: "DENIED", items: [] };

  return <main className="s19-customer-page">
    <div className="s19-customer-back-row"><a className="s19-customer-back" href="/admin/customers">&lt;- Customers</a><a className="s19-button s19-button-secondary" href={`/admin/customers/${customerId}/engagement`}>View engagement timeline</a></div>
    <header className="s19-customer-profile-header"><div><p className="s19-eyebrow">CUSTOMER 360</p><h1>Customer profile</h1><h2>{profile.displayName}</h2><p>Tenant-wide profile - created {date(profile.createdAt)}</p></div><div className="s19-customer-profile-status"><span className="s19-status s19-status-info">{status(profile.status)}</span>{profile.isGuest ? <span className="s19-status s19-status-warning">Guest</span> : <span className="s19-status s19-status-success">Registered</span>}</div></header>
    <div className="s19-customer-detail-grid">
      <Section title="Overview" eyebrow="PROFILE"><dl className="s19-customer-summary"><div><dt>Status</dt><dd>{status(profile.status)}</dd></div><div><dt>Preferred locale</dt><dd>{profile.preferredLocale ?? "-"}</dd></div><div><dt>Phone</dt><dd>{data.contact?.phone ?? "-"}</dd></div><div><dt>Email</dt><dd>{data.contact?.email ?? "-"}</dd></div><div><dt>Guest status</dt><dd>{profile.isGuest ? "Guest profile" : "Customer"}</dd></div><div><dt>Created</dt><dd>{date(profile.createdAt)}</dd></div></dl><p className="s19-customer-readonly-note">Customer profile editing is not available in this release.</p></Section>
      <Section title="Activity summary" eyebrow="VISITS"><dl className="s19-customer-kpi-grid"><div><dt>Appointments</dt><dd>{summary.appointmentCount ?? "Restricted"}</dd></div><div><dt>Completed visits</dt><dd>{summary.completedVisitCount ?? "Restricted"}</dd></div><div><dt>Last visit</dt><dd>{date(summary.lastVisitAt)}</dd></div><div><dt>Next appointment</dt><dd>{date(summary.nextAppointmentAt)}</dd></div></dl></Section>
      <Section title="Appointments and visits" eyebrow="RECENT ACTIVITY">{Array.isArray(data.recentAppointments) && data.recentAppointments.length ? <div className="s19-customer-list">{data.recentAppointments.map((item: any) => <article className="s19-customer-list-item" key={item.id}><div><strong>{item.bookingReference ?? item.id}</strong><span>{date(item.scheduledStartAt)} - Branch {item.branchId}</span></div><span className="s19-status s19-status-info">{status(item.status)}</span></article>)}</div> : <p className="s19-helper">No appointment history is available.</p>}</Section>
      <Section title="Purchases" eyebrow="FINANCIAL HISTORY">{purchases.access === "DENIED" ? <Restricted title="Purchase history restricted" /> : purchases.items?.length ? <div className="s19-customer-list">{purchases.items.map((item: any) => <article className="s19-customer-list-item" key={item.invoiceId}><div><strong>{item.invoiceNumber ?? item.invoiceId}</strong><span>{date(item.issuedAt)} - Branch {item.branchId}</span></div><b>{money(item.totalMinor, item.currency)}</b></article>)}</div> : <p className="s19-helper">No purchase history is available.</p>}</Section>
      <Section title="Refunds" eyebrow="FINANCIAL HISTORY">{refunds.access === "DENIED" ? <Restricted title="Refund history restricted" /> : refunds.items?.length ? <div className="s19-customer-list">{refunds.items.map((item: any) => <article className="s19-customer-list-item" key={item.refundId}><div><strong>{item.refundReference ?? item.refundId}</strong><span>{date(item.createdAt)} - Branch {item.branchId}</span></div><b>{money(item.completedMinor ?? item.requestedMinor, item.currency)}</b></article>)}</div> : <p className="s19-helper">No refund history is available.</p>}</Section>
      <Section title="Benefits and engagement" eyebrow="CONNECTED DOMAINS"><div className="s19-customer-link-grid"><a href={`/admin/benefits/customers/${customerId}`}>Benefits wallet</a><a href={`/admin/loyalty/customers/${customerId}`}>Loyalty ledger</a><a href={`/admin/membership/customers/${customerId}`}>Membership history</a><a href="/admin/packages/entitlements">Package entitlements</a><a href={`/admin/customers/${customerId}/engagement`}>Engagement timeline</a></div></Section>
    </div>
  </main>;
}
