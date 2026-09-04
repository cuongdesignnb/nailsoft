/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import { SafeDataTable, safeLabel } from "./safe-data-view";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type Config = { title: string; endpoint: string; create?: string; actions?: string[]; hint: string };

const tenant: Record<string, Config> = {
  "/admin/billing": { title: "Tổng quan gói dịch vụ", endpoint: "/v1/tenant/billing/subscription", hint: "Theo dõi gói, trạng thái truy cập và kỳ gia hạn của salon." },
  "/admin/billing/subscription": { title: "Gói dịch vụ", endpoint: "/v1/tenant/billing/subscription", actions: ["change-plan", "cancel", "reactivate"], hint: "Vòng đời gói có phiên bản; thay đổi gói không xóa dữ liệu salon." },
  "/admin/billing/plans": { title: "Danh mục gói", endpoint: "/v1/tenant/billing/plans", hint: "Các gói đã được công bố và thông tin giá theo dữ liệu máy chủ." },
  "/admin/billing/usage": { title: "Mức sử dụng & hạn mức", endpoint: "/v1/tenant/billing/usage", hint: "Số liệu sử dụng và hạn mức được tính từ dữ liệu được ghi nhận." },
  "/admin/billing/invoices": { title: "Hóa đơn nền tảng", endpoint: "/v1/tenant/billing/invoices", actions: ["pay"], hint: "Tách biệt với hóa đơn bán hàng của salon." },
  "/admin/billing/payment-methods": { title: "Phương thức thanh toán", endpoint: "/v1/tenant/billing/payment-methods", create: "/v1/tenant/billing/payment-methods", hint: "Chỉ lưu tham chiếu token; không hiển thị dữ liệu thẻ thô." },
  "/admin/billing/history": { title: "Lịch sử thanh toán", endpoint: "/v1/tenant/billing/invoices", hint: "Dòng thời gian hóa đơn và thu tiền bất biến." },
  "/admin/support-access": { title: "Quyền hỗ trợ", endpoint: "/v1/tenant/support-access-grants", actions: ["approve", "deny", "revoke"], hint: "Quyền hỗ trợ phải có phạm vi, thời hạn và được salon nhìn thấy." },
};

const platform: Record<string, Config> = {
  "/platform/plans": { title: "Danh mục gói nền tảng", endpoint: "/v1/platform/plans", create: "/v1/platform/plans", hint: "Quản lý phiên bản gói ở phạm vi nền tảng." },
  "/platform/prices": { title: "Danh mục giá", endpoint: "/v1/platform/prices", create: "/v1/platform/prices", actions: ["activate"], hint: "Giá dùng đơn vị nhỏ nhất và chu kỳ rõ ràng." },
  "/platform/discounts": { title: "Chương trình giảm giá", endpoint: "/v1/platform/plans", hint: "Thông tin giảm giá có bằng chứng từ nền tảng." },
  "/platform/tenants": { title: "Vòng đời tenant", endpoint: "/v1/platform/tenants", hint: "Theo dõi trạng thái thanh toán mà không mở dữ liệu vận hành salon." },
  "/platform/invoices": { title: "Vận hành hóa đơn", endpoint: "/v1/platform/invoices", create: "/v1/platform/invoices", actions: ["calculate", "finalize", "void"], hint: "Hóa đơn đã chốt và dòng hóa đơn không thể sửa." },
  "/platform/payments": { title: "Vận hành thanh toán", endpoint: "/v1/platform/payment-intents", create: "/v1/platform/payment-intents", actions: ["confirm", "reconcile"], hint: "Theo dõi khóa nhà cung cấp và các kết quả cần đối soát." },
  "/platform/refunds": { title: "Hoàn tiền nền tảng", endpoint: "/v1/platform/payment-intents", hint: "Giới hạn hoàn tiền và phê duyệt độc lập được lưu thành bằng chứng." },
  "/platform/reconciliation": { title: "Đối soát nền tảng", endpoint: "/v1/platform/payment-intents", actions: ["reconcile"], hint: "Xử lý kết quả chưa xác định trước khi thử lại với nhà cung cấp." },
  "/platform/dunning": { title: "Nhắc thanh toán", endpoint: "/v1/platform/invoices", hint: "Theo dõi các bước nhắc thanh toán và chuyển trạng thái truy cập." },
  "/platform/support-access": { title: "Cấp quyền hỗ trợ", endpoint: "/v1/platform/support-access-grants", create: "/v1/platform/support-access-grants", actions: ["start-session"], hint: "Không mở dữ liệu salon nếu chưa có grant đang hoạt động." },
  "/platform/break-glass": { title: "Quyền khẩn cấp", endpoint: "/v1/platform/support-access-grants", hint: "Tắt mặc định; chỉ mở qua quy trình phê duyệt kép." },
  "/platform/reports": { title: "Báo cáo nền tảng", endpoint: "/v1/platform/tenants", hint: "Chỉ gồm dữ liệu SaaS; không gồm POS và bảng lương salon." },
};

const actionLabels: Record<string, string> = {
  "change-plan": "Đổi gói", cancel: "Hủy", reactivate: "Kích hoạt lại", pay: "Thanh toán", approve: "Phê duyệt", deny: "Từ chối", revoke: "Thu hồi", activate: "Kích hoạt", calculate: "Tính lại", finalize: "Chốt hóa đơn", void: "Vô hiệu hóa", confirm: "Xác nhận", reconcile: "Đối soát", "start-session": "Bắt đầu phiên",
};

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Bạn không có quyền truy cập phạm vi này."), { forbidden: true });
  if (!response.ok) throw new Error(`${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Không thể hoàn tất yêu cầu."}`);
  return body.data;
}

function listOf(value: any): any[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

export default function Sprint13Screen() {
  const pathname = usePathname();
  const tenantDetail = pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/(subscription|entitlements|usage|invoices|payments|lifecycle))?$/);
  const invoiceDetail = pathname.match(/^\/admin\/billing\/invoices\/([^/]+)$/);
  let config: Config | undefined;
  if (tenantDetail) {
    const id = tenantDetail[1];
    const part = tenantDetail[2];
    config = { title: `Tenant · ${part ?? "tổng quan"}`, endpoint: part === "usage" ? `/v1/platform/tenants/${id}/usage/aggregates` : `/v1/platform/tenants/${id}`, hint: "Phạm vi nền tảng; lịch hẹn và bảng lương salon không nằm trong màn hình này." };
  } else if (invoiceDetail) {
    config = { title: "Chi tiết hóa đơn", endpoint: `/v1/tenant/billing/invoices/${invoiceDetail[1]}`, actions: ["pay"], hint: "Hóa đơn nền tảng đã chốt là bằng chứng bất biến." };
  } else {
    config = Object.entries({ ...tenant, ...platform }).sort((a, b) => b[0].length - a[0].length).find(([path]) => pathname === path)?.[1];
  }
  return <Workspace config={config ?? tenant["/admin/billing"]!} pathname={pathname} />;
}

function Workspace({ config, pathname }: { config: Config; pathname: string }) {
  const [state, setState] = useState<State>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = config.endpoint;

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const nextRows = listOf(await api(endpoint));
      setRows(nextRows);
      setState(nextRows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !["evidenceJson", "snapshotJson", "permissionScopeJson", "dataClassificationScopeJson"].includes(key))
    .slice(0, 9)
    .map((key) => ({ key, label: safeLabel(key) })), [rows]);

  async function act(row: any, action: string) {
    try {
      const base = pathname.startsWith("/admin/support-access") ? "/v1/tenant/support-access-grants" : pathname.startsWith("/platform/support-access") ? "/v1/platform/support-access-grants" : pathname.startsWith("/platform/prices") ? "/v1/platform/prices" : pathname.startsWith("/platform/invoices") ? "/v1/platform/invoices" : pathname.startsWith("/platform/payments") || pathname.startsWith("/platform/reconciliation") ? "/v1/platform/payment-intents" : "/v1/tenant/billing/invoices";
      await api(`${base}/${row.id}/${action}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ tenantId: row.tenantId, version: row.version, reason: "Được xác nhận trong quy trình vận hành." }) });
      setNotice(`${actionLabels[action] ?? action} đã được máy chủ xác nhận.`);
      await load();
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể thực hiện thao tác.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }

  return <main className="ns-data-workspace">
    <header className="ns-page-header"><div><p className="eyebrow">{pathname.startsWith("/platform") ? "NỀN TẢNG" : "THANH TOÁN & QUYỀN TRUY CẬP"}</p><h1>{config.title}</h1><p className="hint">{config.hint}</p></div><button className="ns-button ns-button--secondary" onClick={() => void load()}>Làm mới</button></header>
    {notice && <p className="ns-inline-notice" role="status">{notice}</p>}
    {state === "loading" && <div className="ns-state" role="status" aria-busy="true"><strong>Đang tải dữ liệu…</strong><span>Đang đồng bộ từ máy chủ.</span></div>}
    {state === "forbidden" && <div className="ns-state ns-state--danger" role="alert"><strong>Không có quyền truy cập</strong><span>Vai trò hoặc phạm vi hiện tại không cho phép xem dữ liệu này.</span></div>}
    {state === "error" && <div className="ns-state ns-state--danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Thử lại</button></div>}
    {state === "empty" && <div className="ns-empty-state"><strong>Chưa có dữ liệu</strong><span>Hệ thống chưa ghi nhận bản ghi phù hợp với phạm vi hiện tại.</span><button className="ns-button ns-button--secondary" onClick={() => void load()}>Kiểm tra lại</button></div>}
    {state === "ready" && <section className="ns-data-card"><div className="ns-section-heading"><div><p className="eyebrow">DỮ LIỆU NGUỒN</p><h2>{rows.length} bản ghi trong phạm vi hiện tại</h2></div><span className="ns-chip">Được máy chủ kiểm soát</span></div><SafeDataTable rows={rows} columns={columns} caption={`Danh sách ${config.title}`} />{config.actions?.length ? <div className="ns-action-row">{rows.slice(0, 1).flatMap((row) => config.actions!.map((action) => <button key={action} className="ns-button ns-button--secondary" onClick={() => void act(row, action)}>{actionLabels[action] ?? action}</button>))}</div> : null}</section>}
    {config.create && <aside className="ns-data-card ns-data-card--muted"><p className="eyebrow">THAO TÁC AN TOÀN</p><h2>Biểu mẫu chuyên biệt được yêu cầu</h2><p>Màn hình tổng quát chỉ đọc dữ liệu đã được phân quyền. Tạo mới cần đi qua biểu mẫu nghiệp vụ tương ứng để kiểm tra đầy đủ trường và bằng chứng.</p></aside>}
    <aside className="ns-data-card ns-data-card--muted"><p className="eyebrow">RANH GIỚI DỮ LIỆU</p><h2>Dữ liệu nền tảng tách biệt với vận hành salon</h2><p>Thông tin thanh toán, quyền hỗ trợ và trạng thái tenant được giữ trong phạm vi riêng; giao diện không mở dữ liệu POS, stored value hoặc bảng lương ngoài quyền hiện tại.</p></aside>
  </main>;
}
