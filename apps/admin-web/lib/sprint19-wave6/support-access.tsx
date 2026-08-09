"use client";

import { ReadWorkspace, DualControlNotice, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const columns: Column[] = [{ key: "tenantId", label: "Target tenant" }, { key: "supportUserId", label: "Support user" }, { key: "status", label: "Status", status: true }, { key: "expiresAt", label: "Expires" }, { key: "version", label: "Version" }];

export default function SupportAccessWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/platform/break-glass") return <main className="shell ops-shell"><section className="card"><p className="eyebrow">SPRINT 19 · WAVE 6 · 19.6.29</p><h1>Break-glass access</h1><p>Emergency break-glass access is disabled by platform security policy.</p><p className="ns-gallery-banner"><strong>Status:</strong> DISABLED · No token, credential or emergency session can be issued.</p></section></main>;
  const endpoint = route.href === "/platform/support-access" ? "/v1/platform/support-access-grants" : "/v1/tenant/support-access-grants";
  const prefix = route.href === "/platform/support-access" ? "/v1/platform/support-access-grants" : "/v1/tenant/support-access-grants";
  return <ReadWorkspace route={route} endpoint={endpoint} columns={columns} actions={[{ label: "Approve", path: (row) => `${prefix}/${row.id}/approve`, body: (row) => ({ version: row.version }) }, { label: "Deny", path: (row) => `${prefix}/${row.id}/deny`, body: (row) => ({ version: row.version, reason: "Reviewed in support workspace" }) }, { label: "Revoke", path: (row) => `${prefix}/${row.id}/revoke`, body: (row) => ({ version: row.version, reason: "Revoked in support workspace" }) }]}><DualControlNotice>Support access is tenant-targeted, time-limited and audited. A support session never grants global tenant or salon operational data.</DualControlNotice></ReadWorkspace>;
}
