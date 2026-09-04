"use client";

import { ReadWorkspace, DualControlNotice, type Column } from "./shared";
import type { Wave6Route } from "./routes";

const columns: Column[] = [{ key: "tenantId", label: "Target tenant" }, { key: "supportUserId", label: "Support user" }, { key: "status", label: "Status", status: true }, { key: "expiresAt", label: "Expires" }, { key: "version", label: "Version" }];

export default function SupportAccessWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/platform/break-glass") return <main className="shell ops-shell"><section className="card"><p className="eyebrow">QUYỀN HỖ TRỢ KHẨN CẤP</p><h1 aria-label="Break-glass access">Quyền truy cập khẩn cấp</h1><p>Quyền truy cập khẩn cấp đang bị tắt theo chính sách bảo mật nền tảng.</p><p className="ns-gallery-banner"><strong>Trạng thái:</strong> ĐÃ TẮT · Không thể cấp token, thông tin đăng nhập hoặc phiên khẩn cấp.</p></section></main>;
  const platformScope = route.href === "/platform/support-access" || route.href === "/platform/support-access-grants";
  const endpoint = platformScope ? "/v1/platform/support-access-grants" : "/v1/tenant/support-access-grants";
  const prefix = platformScope ? "/v1/platform/support-access-grants" : "/v1/tenant/support-access-grants";
  return <ReadWorkspace route={route} endpoint={endpoint} columns={columns} actions={[{ label: "Approve", path: (row) => `${prefix}/${row.id}/approve`, body: (row) => ({ version: row.version }) }, { label: "Deny", path: (row) => `${prefix}/${row.id}/deny`, body: (row) => ({ version: row.version, reason: "Reviewed in support workspace" }) }, { label: "Revoke", path: (row) => `${prefix}/${row.id}/revoke`, body: (row) => ({ version: row.version, reason: "Revoked in support workspace" }) }]}><DualControlNotice>Support access is tenant-targeted, time-limited and audited. A support session never grants global tenant or salon operational data.</DualControlNotice></ReadWorkspace>;
}
