"use client";

import { FieldForm, ReadWorkspace, DualControlNotice, ImmutableRecordBadge, type Column } from "./shared";
import type { Wave6Route } from "./routes";
import { commandApi } from "./shared";

const planColumns: Column[] = [{ key: "code", label: "Plan" }, { key: "name", label: "Name" }, { key: "status", label: "Status", status: true }, { key: "version", label: "Version" }];
const priceColumns: Column[] = [{ key: "planCode", label: "Plan" }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "interval", label: "Interval" }, { key: "status", label: "Status", status: true }];
const discountColumns: Column[] = [{ key: "code", label: "Code" }, { key: "discountType", label: "Type" }, { key: "amountMinor", label: "Amount", money: true }, { key: "currency", label: "Currency" }, { key: "startsAt", label: "Starts" }, { key: "endsAt", label: "Ends" }, { key: "active", label: "Active" }];

export default function PlatformCatalogWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/platform/discounts") return <ReadWorkspace route={route} endpoint="/v1/platform/discounts" columns={discountColumns} description="Discount definitions are read-only in Wave 6; mutation lifecycle is deferred." ><p className="ns-gallery-banner"><ImmutableRecordBadge /> No create, edit or delete action is exposed for discounts.</p></ReadWorkspace>;
  if (route.href === "/platform/prices") return <ReadWorkspace route={route} endpoint="/v1/platform/prices" columns={priceColumns} actions={[{ label: "Activate", path: (row) => `/v1/platform/prices/${row.id}/activate`, body: (row) => ({ version: row.version }) }]}><FieldForm title="Create price" fields={[{ name: "planVersionId", label: "Plan version ID", required: true }, { name: "amountMinor", label: "Amount in minor units", required: true }, { name: "currency", label: "Currency", required: true }, { name: "interval", label: "Billing interval", options: ["MONTH", "YEAR"], required: true }]} onSubmit={async (values) => { await commandApi("/v1/platform/prices", values); }} note="Enter integer minor units; no floating-point billing arithmetic is performed in the browser." /></ReadWorkspace>;
  return <ReadWorkspace route={route} endpoint="/v1/platform/plans" columns={planColumns} actions={[{ label: "Publish version", path: (row) => `/v1/platform/plans/${row.id}/versions/${row.latestVersionId}/publish`, body: (row) => ({ version: row.version }) }]}><DualControlNotice>Plan versions are immutable after publish. Catalog configuration is unavailable during a support session.</DualControlNotice><FieldForm title="Create plan" fields={[{ name: "code", label: "Plan code", required: true }, { name: "name", label: "Plan name", required: true }, { name: "description", label: "Description" }]} onSubmit={async (values) => { await commandApi("/v1/platform/plans", { ...values, name: { "en-US": values.name, "vi-VN": values.name } }); }} /></ReadWorkspace>;
}
