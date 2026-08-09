"use client";

import { ReadWorkspace, DualControlNotice, ImmutableRecordBadge, MetricCards, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const invoiceColumns: Column[] = [{ key: "invoiceNumber", label: "Invoice" }, { key: "tenantId", label: "Tenant" }, { key: "status", label: "Status", status: true }, { key: "totalMinor", label: "Total", money: true }, { key: "currency", label: "Currency" }, { key: "dueAt", label: "Due" }];
const paymentColumns: Column[] = [{ key: "invoiceId", label: "Invoice" }, { key: "tenantId", label: "Tenant" }, { key: "status", label: "Status", status: true }, { key: "amountMinor", label: "Amount", money: true }, { key: "provider", label: "Provider" }, { key: "createdAt", label: "Created" }];
const refundColumns: Column[] = [{ key: "paymentIntentId", label: "Payment" }, { key: "tenantId", label: "Tenant" }, { key: "status", label: "Status", status: true }, { key: "requestedMinor", label: "Requested", money: true }, { key: "completedMinor", label: "Completed", money: true }, { key: "currency", label: "Currency" }];
const reconciliationColumns: Column[] = [{ key: "kind", label: "Evidence" }, { key: "status", label: "Status", status: true }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "createdAt", label: "Created" }];
const dunningColumns: Column[] = [{ key: "tenantId", label: "Tenant" }, { key: "invoiceNumber", label: "Invoice" }, { key: "status", label: "Status", status: true }, { key: "accessMode", label: "Access mode" }, { key: "dueAt", label: "Due" }];

export default function PlatformPaymentsWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/platform/invoices") return <ReadWorkspace route={route} endpoint="/v1/platform/invoices" columns={invoiceColumns} actions={[{ label: "Calculate", path: (row) => `/v1/platform/invoices/${row.id}/calculate`, body: (row) => ({ version: row.version }) }, { label: "Finalize", path: (row) => `/v1/platform/invoices/${row.id}/finalize`, body: (row) => ({ version: row.version }) }]}><ImmutableRecordBadge /></ReadWorkspace>;
  if (route.href === "/platform/payments") return <ReadWorkspace route={route} endpoint="/v1/platform/payment-intents" columns={paymentColumns} actions={[{ label: "Reconcile", path: (row) => `/v1/platform/payment-intents/${row.id}/reconcile`, body: (row) => ({ version: row.version }) }]}><p className="ns-gallery-banner">Provider calls happen outside database transactions; UNKNOWN outcomes require reconciliation before retry.</p></ReadWorkspace>;
  if (route.href === "/platform/reconciliation") return <ReadWorkspace route={route} endpoint="/v1/platform/reconciliation" columns={reconciliationColumns} description="Reconciliation status is read from persisted provider evidence; a timeout is never presented as FAILED." />;
  if (route.href === "/platform/dunning" || route.href === "/platform/reports") return <DunningAndReports route={route} />;
  return <ReadWorkspace route={route} endpoint="/v1/platform/refunds" columns={refundColumns} actions={[{ label: "Submit", path: (row) => `/v1/platform/refunds/${row.id}/submit`, body: (row) => ({ version: row.version }) }, { label: "Approve", path: (row) => `/v1/platform/refunds/${row.id}/approve`, body: (row) => ({ version: row.version }) }, { label: "Reconcile", path: (row) => `/v1/platform/refunds/${row.id}/reconcile`, body: (row) => ({ version: row.version }) }]}><DualControlNotice>Refund approval is independent from the requester and cumulative caps remain server-authoritative.</DualControlNotice></ReadWorkspace>;
}

function DunningAndReports({ route }: { route: Wave6Route }) {
  const endpoint = route.href === "/platform/reports" ? "/v1/platform/reports" : "/v1/platform/dunning";
  const columns = route.href === "/platform/reports" ? [{ key: "tenantCount", label: "Tenants" }, { key: "activeSubscriptionCount", label: "Active subscriptions" }, { key: "invoiceTotalMinor", label: "Invoice total", money: true }, { key: "collectionTotalMinor", label: "Collected", money: true }] : dunningColumns;
  return <ReadWorkspace route={route} endpoint={endpoint} columns={columns as Column[]} description={route.href === "/platform/reports" ? "SaaS-only report metrics; salon POS, payroll and customer data are excluded." : "Read-only delinquency monitoring; manual dunning actions are deferred."}><MetricCards values={[]} /></ReadWorkspace>;
}
