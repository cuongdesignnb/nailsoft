"use client";

import { FieldForm, ReadWorkspace, DualControlNotice, type Column } from "./shared";
import type { Wave6Route } from "./routes";
import { commandApi } from "./shared";

const subscriptionColumns: Column[] = [{ key: "planName", label: "Plan" }, { key: "status", label: "Status", status: true }, { key: "currentPeriodEnd", label: "Renewal" }, { key: "version", label: "Version" }];
const usageColumns: Column[] = [{ key: "code", label: "Meter" }, { key: "periodStart", label: "From" }, { key: "periodEnd", label: "To" }, { key: "quantity", label: "Usage" }, { key: "quota", label: "Quota" }];
const invoiceColumns: Column[] = [{ key: "invoiceNumber", label: "Invoice" }, { key: "status", label: "Status", status: true }, { key: "totalMinor", label: "Total", money: true }, { key: "currency", label: "Currency" }, { key: "dueAt", label: "Due" }];
const methodColumns: Column[] = [{ key: "provider", label: "Provider" }, { key: "methodType", label: "Method" }, { key: "display", label: "Masked display" }, { key: "status", label: "Status", status: true }];
const grantColumns: Column[] = [{ key: "tenantId", label: "Tenant" }, { key: "status", label: "Status", status: true }, { key: "expiresAt", label: "Expires" }, { key: "requesterUserId", label: "Requester" }, { key: "version", label: "Version" }];

export default function TenantBillingWorkspace({ route }: { route: Wave6Route }) {
  const path = route.href;
  if (route.screenId === "19.6.18") return <ReadWorkspace route={route} endpoint="/v1/tenant/support-access-grants" columns={grantColumns} actions={[{ label: "Approve", path: (row) => `/v1/tenant/support-access-grants/${row.id}/approve`, body: (row) => ({ version: row.version }) }, { label: "Deny", path: (row) => `/v1/tenant/support-access-grants/${row.id}/deny`, body: (row) => ({ version: row.version, reason: "Reviewed in tenant support workspace" }) }, { label: "Revoke", path: (row) => `/v1/tenant/support-access-grants/${row.id}/revoke`, body: (row) => ({ version: row.version, reason: "Revoked in tenant support workspace" }) }]}><DualControlNotice>Requesters cannot approve their own support grant. Scope, expiry and audit evidence remain server-authoritative.</DualControlNotice></ReadWorkspace>;
  if (path === "/admin/billing/plans") return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/plans" columns={subscriptionColumns} description="Published tenant plans and prices are read from the billing contract." />;
  if (path === "/admin/billing/history") return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/invoices" columns={invoiceColumns} description="Immutable invoice and collection history." />;
  if (route.screenId === "19.6.17") return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/payment-methods" columns={methodColumns} description="Provider and masked method status only; raw card data is never collected in this UI." />;
  if (route.screenId === "19.6.15" || route.screenId === "19.6.16") {
    const match = path.match(/\/admin\/billing\/invoices\/([^/]+)$/); const endpoint = match ? `/v1/tenant/billing/invoices/${encodeURIComponent(match[1]!)}` : "/v1/tenant/billing/invoices";
    return <ReadWorkspace route={route} endpoint={endpoint} columns={invoiceColumns} actions={match ? [] : [{ label: "Pay", path: (row) => `/v1/tenant/billing/invoices/${row.id}/pay`, body: (row) => ({ version: row.version }) }]}><p className="ns-gallery-banner"><strong>Platform subscription invoice:</strong> This is separate from salon POS invoices.</p></ReadWorkspace>;
  }
  if (route.screenId === "19.6.14") return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/usage" columns={usageColumns} description="Usage and quota are effective server projections; the browser does not calculate entitlements." />;
  if (route.screenId === "19.6.13") return <SubscriptionWorkspace route={route} />;
  return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/subscription" columns={subscriptionColumns} description="Subscription billing overview with renewal and access evidence." />;
}

function SubscriptionWorkspace({ route }: { route: Wave6Route }) {
  return <ReadWorkspace route={route} endpoint="/v1/tenant/billing/subscription" columns={subscriptionColumns} actions={[{ label: "Cancel", path: () => "/v1/tenant/billing/subscription/cancel", body: (row) => ({ version: row.version, reason: "Requested in billing workspace" }) }, { label: "Reactivate", path: () => "/v1/tenant/billing/subscription/reactivate", body: (row) => ({ version: row.version }) }]}>
    <DualControlNotice>Subscription lifecycle transitions are explicit, idempotent and confirmed by the server.</DualControlNotice>
    <FieldForm title="Change plan" fields={[{ name: "planId", label: "Published plan ID", required: true }, { name: "effectiveAt", label: "Effective at", type: "datetime-local" }]} onSubmit={async (values) => { await commandApi("/v1/tenant/billing/subscription/change-plan", values); }} note="Downgrade timing and proration are determined by the current billing contract." />
  </ReadWorkspace>;
}
