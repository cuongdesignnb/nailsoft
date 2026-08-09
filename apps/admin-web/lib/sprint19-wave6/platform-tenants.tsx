"use client";

import { ReadWorkspace, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const tenantColumns: Column[] = [{ key: "name", label: "Tenant" }, { key: "slug", label: "Slug" }, { key: "accessMode", label: "Access mode", status: true }, { key: "subscriptionStatus", label: "Subscription", status: true }, { key: "createdAt", label: "Created" }];
const detailColumns: Column[] = [{ key: "name", label: "Tenant" }, { key: "slug", label: "Slug" }, { key: "accessMode", label: "Access mode", status: true }, { key: "subscriptionStatus", label: "Subscription", status: true }, { key: "planCode", label: "Plan" }];
const entitlementColumns: Column[] = [{ key: "code", label: "Entitlement" }, { key: "value", label: "Effective value" }, { key: "source", label: "Source" }, { key: "expiresAt", label: "Expires" }];
const invoiceColumns: Column[] = [{ key: "invoiceNumber", label: "Invoice" }, { key: "status", label: "Status", status: true }, { key: "totalMinor", label: "Total", money: true }, { key: "currency", label: "Currency" }, { key: "issuedAt", label: "Issued" }];
const paymentColumns: Column[] = [{ key: "invoiceId", label: "Invoice" }, { key: "status", label: "Status", status: true }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "createdAt", label: "Created" }];

export default function PlatformTenantsWorkspace({ route }: { route: Wave6Route }) {
  const match = route.href.match(/^\/platform\/tenants\/([^/]+)(?:\/(.*))?$/); const tenantId = match?.[1]; const suffix = match?.[2];
  if (!tenantId || tenantId === "detail") return <ReadWorkspace route={route} endpoint="/v1/platform/tenants" columns={tenantColumns} description="Global directory for Platform Admin; an active Support Access session is target-tenant only." />;
  const endpoint = suffix === "entitlements" || suffix === "usage" ? `/v1/platform/tenants/${tenantId}/entitlements` : suffix === "invoices" || suffix === "payments" ? `/v1/platform/tenants/${tenantId}/${suffix}` : `/v1/platform/tenants/${tenantId}`;
  const columns = suffix === "entitlements" || suffix === "usage" ? entitlementColumns : suffix === "payments" ? paymentColumns : suffix === "invoices" ? invoiceColumns : detailColumns;
  return <ReadWorkspace route={route} endpoint={endpoint} columns={columns} description="Platform billing context only. Customers, appointments, payroll and salon POS are not exposed." />;
}
