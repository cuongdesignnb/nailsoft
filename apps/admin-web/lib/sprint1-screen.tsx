/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import Sprint3Screen from "./sprint3-screen";
import Sprint4Screen from "./sprint4-screen";
import Sprint5Screen from "./sprint5-screen";
import Sprint6Screen from "./sprint6-screen";
import Sprint7Screen from "./sprint7-screen";
import Sprint8Screen from "./sprint8-screen";
import Sprint9Screen from "./sprint9-screen";
import Sprint10Screen from "./sprint10-screen";
import Sprint11Screen from "./sprint11-screen";
import Sprint12Screen from "./sprint12-screen";
import Sprint13Screen from "./sprint13-screen";
import Sprint14Screen from "./sprint14-screen";
import Sprint15Screen from "./sprint15-screen";
import Sprint16Screen from "./sprint16-screen";
import Sprint19Wave1Screen from "./sprint19-wave1-screen";
import DashboardOverview from "./dashboard-overview";
import AppointmentsOverview from "./appointments-overview";
import Sprint19Wave1Remediation, { isWave1RemediationPath } from "./sprint19-wave1-remediation";
import Sprint19Wave2Screen, { isWave2Path } from "./sprint19-wave2-screen";
import Sprint19Wave3CustomerScreen, { isWave3Path } from "./sprint19-wave3-screen";
import Sprint19Wave4Screen, { isWave4Path } from "./sprint19-wave4-screen";
import Sprint19Wave5Inventory, { isWave5InventoryPath } from "./sprint19-wave5-inventory";
import Sprint19Wave5Procurement, { isWave5ProcurementPath } from "./sprint19-wave5-procurement";
import Sprint19Wave5Assets, { isWave5AssetsPath } from "./sprint19-wave5-assets";
import Sprint19Wave6Screen, { isWave6Path } from "./sprint19-wave6-screen";
import PosCheckoutWorkspace, { posWorkspaceRoute } from "./pos/pos-checkout-workspace";
import PosOrderListPage from "./pos/pos-order-list-page";
import PosOrderDetailPage from "./pos/pos-order-detail";
import PosRegisterManagementPage from "./pos/pos-register-management";
import OpenCashSessionPage from "./pos/open-cash-session-page";
import CashSessionHistoryPage from "./pos/cash-session-history-page";
import CashSessionDetailPage from "./pos/cash-session-detail-page";
import CashSessionClosingPage from "./pos/cash-session-closing-page";
import InvoiceDirectoryPage from "./financial/invoice-directory-page";
import PaymentTransactionDirectoryPage from "./financial/payment-directory-page";
import PaymentReconciliationPage from "./financial/payment-reconciliation-page";
import RefundDirectoryPage from "./financial/refund-directory-page";
import RefundDetailPage from "./financial/refund-detail-page";
import CreditNoteDirectoryPage from "./financial/credit-note-directory-page";
import EmployeeCommissionPage from "./financial/employee-commission-page";
import CommissionAdjustmentsPage from "./financial/commission-adjustments-page";
import NetSalesPage from "./financial/net-sales-page";

type Resource = {
  title: string;
  accessibleTitle?: string;
  endpoint: string;
  empty: string;
  columns?: Array<{ name: string; label: string }>;
  fields?: Array<{
    name: string;
    label: string;
    type?: string;
    required?: boolean;
  }>;
  actions?: Array<{ label: string; path: (id: string) => string }>;
};
type ApiState = "loading" | "ready" | "empty" | "error" | "forbidden";

const resources: Record<string, Resource> = {
  "/admin/catalog/categories": {
    title: "Nhóm dịch vụ",
    accessibleTitle: "Service categories",
    endpoint: "/v1/service-categories",
    empty: "Chưa có nhóm dịch vụ trong phạm vi được cấp quyền.",
    columns: [
      { name: "code", label: "Mã nhóm" },
      { name: "name", label: "Tên nhóm" },
      { name: "status", label: "Trạng thái" },
      { name: "version", label: "Phiên bản" },
    ],
    fields: [
      { name: "code", label: "Mã nhóm", required: true },
      { name: "name", label: "Tên nhóm", required: true },
    ],
    actions: [
      {
        label: "Lưu trữ",
        path: (id) => `/v1/service-categories/${id}/archive`,
      },
    ],
  },
  "/admin/catalog/services": {
    title: "Danh mục dịch vụ",
    endpoint: "/v1/services?status=ACTIVE&page=1&pageSize=50",
    empty: "Chưa có dịch vụ đang hoạt động.",
    columns: [
      { name: "code", label: "Mã dịch vụ" },
      { name: "name", label: "Tên dịch vụ" },
      { name: "defaultDurationMin", label: "Thời lượng" },
      { name: "status", label: "Trạng thái" },
    ],
    fields: [
      { name: "categoryId", label: "Mã nhóm dịch vụ", required: true },
      { name: "code", label: "Mã dịch vụ", required: true },
      { name: "name", label: "Tên dịch vụ", required: true },
      {
        name: "defaultDurationMin",
        label: "Thời lượng (phút)",
        type: "number",
        required: true,
      },
    ],
    actions: [{ label: "Lưu trữ", path: (id) => `/v1/services/${id}/archive` }],
  },
  "/admin/catalog/skills": {
    title: "Kỹ năng dịch vụ",
    endpoint: "/v1/skills",
    empty: "Chưa có kỹ năng dịch vụ.",
    columns: [
      { name: "code", label: "Mã kỹ năng" },
      { name: "name", label: "Tên kỹ năng" },
      { name: "status", label: "Trạng thái" },
    ],
    fields: [
      { name: "code", label: "Mã kỹ năng", required: true },
      { name: "name", label: "Tên kỹ năng", required: true },
    ],
    actions: [{ label: "Lưu trữ", path: (id) => `/v1/skills/${id}/archive` }],
  },
  "/admin/catalog/resource-types": {
    title: "Loại tài nguyên",
    endpoint: "/v1/resource-types",
    empty: "Chưa có loại tài nguyên.",
    columns: [
      { name: "code", label: "Mã loại" },
      { name: "name", label: "Tên loại" },
      { name: "status", label: "Trạng thái" },
    ],
    fields: [
      { name: "code", label: "Mã loại", required: true },
      { name: "name", label: "Tên loại", required: true },
    ],
  },
  "/admin/catalog/resources": {
    title: "Tài nguyên chi nhánh",
    endpoint: "/v1/resources",
    empty: "Chưa có tài nguyên chi nhánh.",
    columns: [
      { name: "code", label: "Mã tài nguyên" },
      { name: "name", label: "Tên tài nguyên" },
      { name: "capacity", label: "Sức chứa" },
      { name: "status", label: "Trạng thái" },
    ],
    fields: [
      { name: "branchId", label: "Mã chi nhánh", required: true },
      { name: "resourceTypeId", label: "Mã loại tài nguyên", required: true },
      { name: "code", label: "Mã tài nguyên", required: true },
      { name: "name", label: "Tên tài nguyên", required: true },
      { name: "capacity", label: "Sức chứa", type: "number", required: true },
    ],
    actions: [
      { label: "Lưu trữ", path: (id) => `/v1/resources/${id}/archive` },
    ],
  },
  "/admin/staff/list": {
    title: "Danh sách nhân sự",
    endpoint: "/v1/staff",
    empty: "Chưa có nhân sự trong phạm vi được cấp quyền.",
    columns: [
      { name: "employeeCode", label: "Mã nhân sự" },
      { name: "displayName", label: "Nhân sự" },
      { name: "status", label: "Trạng thái" },
      { name: "version", label: "Phiên bản" },
    ],
    fields: [
      { name: "employeeCode", label: "Mã nhân sự", required: true },
      { name: "displayName", label: "Tên hiển thị", required: true },
      { name: "membershipId", label: "Mã membership" },
    ],
  },
  "/admin/staff/new": {
    title: "Thêm hồ sơ nhân sự",
    endpoint: "/v1/staff",
    empty: "Hoàn tất thông tin để thêm nhân sự.",
    fields: [
      { name: "employeeCode", label: "Mã nhân sự", required: true },
      { name: "displayName", label: "Tên hiển thị", required: true },
      { name: "membershipId", label: "Mã membership" },
    ],
  },
  "/admin/scheduling/shifts": {
    title: "Lập lịch ca làm việc",
    endpoint: "/v1/shifts",
    empty: "Chưa có ca làm việc.",
    columns: [
      { name: "startAt", label: "Bắt đầu" },
      { name: "endAt", label: "Kết thúc" },
      { name: "status", label: "Trạng thái" },
      { name: "version", label: "Phiên bản" },
    ],
    fields: [
      { name: "branchId", label: "Mã chi nhánh", required: true },
      { name: "staffId", label: "Mã nhân sự", required: true },
      {
        name: "startAt",
        label: "Bắt đầu",
        type: "datetime-local",
        required: true,
      },
      { name: "endAt", label: "End", type: "datetime-local", required: true },
    ],
    actions: [
      { label: "Công bố", path: (id) => `/v1/shifts/${id}/publish` },
      { label: "Hủy", path: (id) => `/v1/shifts/${id}/cancel` },
    ],
  },
  "/admin/scheduling/leave-requests": {
    title: "Duyệt yêu cầu nghỉ phép",
    endpoint: "/v1/leave-requests",
    empty: "Không có yêu cầu nghỉ phép đang chờ.",
    columns: [
      { name: "staffId", label: "Nhân sự" },
      { name: "startDate", label: "Từ ngày" },
      { name: "endDate", label: "Đến ngày" },
      { name: "status", label: "Trạng thái" },
    ],
    actions: [
      { label: "Duyệt", path: (id) => `/v1/leave-requests/${id}/approve` },
      { label: "Từ chối", path: (id) => `/v1/leave-requests/${id}/reject` },
      { label: "Hủy", path: (id) => `/v1/leave-requests/${id}/cancel` },
    ],
  },
};

const legacyRoutes: Record<
  string,
  { title: string; accessibleTitle?: string; endpoint?: string; empty: string }
> = {
  "/admin/dashboard": {
    title: "Tổng quan salon",
    endpoint: "/v1/organization",
    empty: "Chưa có thông tin salon.",
  },
  "/admin/organization/general": {
    title: "Thông tin salon",
    endpoint: "/v1/organization",
    empty: "Chưa có cấu hình thông tin salon.",
  },
  "/admin/organization/branches": {
    title: "Chi nhánh",
    endpoint: "/v1/branches",
    empty: "Chưa có chi nhánh.",
  },
  "/admin/team/users": {
    title: "Tài khoản & quyền",
    accessibleTitle: "Team",
    endpoint: "/v1/users",
    empty: "Chưa có thành viên phù hợp.",
  },
  "/admin/security/sessions": {
    title: "Phiên đăng nhập của tôi",
    endpoint: "/v1/auth/sessions",
    empty: "Không có phiên đăng nhập đang hoạt động.",
  },
};

function messageFor(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}
function unwrap(body: any): any[] {
  const value = body?.data;
  return Array.isArray(value) ? value : value ? [value] : [];
}

function labelForKey(key: string) {
  const labels: Record<string, string> = {
    id: "Mã bản ghi",
    code: "Mã",
    name: "Tên",
    displayName: "Tên hiển thị",
    employeeCode: "Mã nhân sự",
    status: "Trạng thái",
    version: "Phiên bản",
    branchId: "Chi nhánh",
    staffId: "Nhân sự",
    categoryId: "Nhóm dịch vụ",
    resourceTypeId: "Loại tài nguyên",
    startAt: "Bắt đầu",
    endAt: "Kết thúc",
    startDate: "Từ ngày",
    endDate: "Đến ngày",
    createdAt: "Ngày tạo",
    updatedAt: "Cập nhật lúc",
    defaultDurationMin: "Thời lượng",
    capacity: "Sức chứa",
  };
  return labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function displayValue(value: any, key?: string) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (Array.isArray(value)) return value.length ? `${value.length} mục` : "Không có";
  if (typeof value === "object") {
    const localized = value["vi-VN"] ?? value["en-US"];
    if (typeof localized === "string") return localized;
    return value.displayName ?? value.name ?? value.code ?? (value.id ? `#${String(value.id).slice(0, 8)}` : "Đã có dữ liệu");
  }
  if (typeof value === "string") {
    const labels: Record<string, string> = {
      ACTIVE: "Đang hoạt động",
      INACTIVE: "Không hoạt động",
      ENABLED: "Đã bật",
      DISABLED: "Đã tắt",
      PENDING: "Đang chờ",
      PENDING_APPROVAL: "Chờ phê duyệt",
      APPROVED: "Đã phê duyệt",
      COMPLETED: "Đã hoàn tất",
      CANCELLED: "Đã hủy",
      FAILED: "Thất bại",
      DRAFT: "Bản nháp",
      OPEN: "Đang mở",
      CLOSED: "Đã đóng",
    };
    if (labels[value]) return labels[value];
  }
  if (key && /(At|Date|Time)$/.test(key) && typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
  }
  return String(value);
}

function inferredColumns(rows: any[], preferred?: Array<{ name: string; label: string }>) {
  if (preferred?.length) return preferred;
  const first = rows[0];
  if (!first || typeof first !== "object") return [];
  return Object.keys(first)
    .filter((key) => !["policy", "metadata", "payload", "raw", "details"].includes(key))
    .slice(0, 5)
    .map((name) => ({ name, label: labelForKey(name) }));
}

export default function Sprint1Screen() {
  const pathname = usePathname();
  if (isWave1RemediationPath(pathname)) {
    return <Sprint19Wave1Remediation pathname={pathname} />;
  }
  if (pathname === "/admin/dashboard") return <DashboardOverview />;
  if (
    pathname === "/admin/appointments" ||
    pathname === "/admin/appointments/" ||
    pathname === "/admin/calendar" ||
    pathname === "/admin/calendar/"
  ) return <AppointmentsOverview />;
  if (
    pathname.startsWith("/admin/calendar") ||
    pathname.startsWith("/admin/availability")
  ) {
    return <Sprint19Wave1Screen pathname={pathname} />;
  }
  if (isWave5AssetsPath(pathname)) return <Sprint19Wave5Assets pathname={pathname} />;
  if (isWave6Path(pathname)) return <Sprint19Wave6Screen pathname={pathname} />;
  if (pathname.startsWith("/admin/assets")) return <Sprint16Screen />;
  if (isWave5ProcurementPath(pathname)) return <Sprint19Wave5Procurement pathname={pathname} />;
  if (pathname.startsWith("/admin/procurement")) return <Sprint15Screen />;
  if (pathname.startsWith("/admin/accounting")) return <Sprint14Screen />;
  if (pathname.startsWith("/admin/billing") || pathname.startsWith("/admin/support-access"))
    return <Sprint13Screen />;
  if (isWave4Path(pathname)) return <Sprint19Wave4Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/time-clock") ||
    pathname.startsWith("/admin/timesheets") ||
    pathname.startsWith("/admin/timesheet-periods") ||
    pathname.startsWith("/admin/workforce") ||
    pathname.startsWith("/admin/payroll") ||
    pathname.startsWith("/admin/payout") ||
    /^\/admin\/staff\/[^/]+\/pay-profile$/.test(pathname)
  )
    return <Sprint12Screen pathname={pathname} />;
  if (isWave3Path(pathname)) return <Sprint19Wave3CustomerScreen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/communications") ||
    pathname.startsWith("/admin/marketing") ||
    pathname.startsWith("/admin/reviews") ||
    pathname.startsWith("/admin/review-requests") ||
    pathname.startsWith("/admin/service-recovery") ||
    /^\/admin\/customers\/[^/]+\/engagement$/.test(pathname)
  )
    return <Sprint11Screen pathname={pathname} />;
  const posOrderDetailMatch = pathname.match(/^\/admin\/pos\/orders\/([^/]+)\/?$/);
  if (posOrderDetailMatch) return <PosOrderDetailPage orderId={posOrderDetailMatch[1]!} />;
  const posWorkspace = posWorkspaceRoute(pathname);
  if (posWorkspace) {
    return <PosCheckoutWorkspace orderId={posWorkspace.orderId} mode={posWorkspace.mode} />;
  }
  if (pathname === "/admin/pos/orders" || pathname === "/admin/pos/orders/") {
    return <PosOrderListPage />;
  }
  if (pathname === "/admin/pos/registers" || pathname === "/admin/pos/registers/") {
    return <PosRegisterManagementPage />;
  }
  if (pathname === "/admin/pos/cash-sessions" || pathname === "/admin/pos/cash-sessions/") {
    return <CashSessionHistoryPage />;
  }
  if (
    pathname === "/admin/pos/cash-sessions/open" ||
    pathname === "/admin/pos/cash-sessions/open/"
  ) {
    return <OpenCashSessionPage />;
  }
  const cashSessionClosingMatch = pathname.match(/^\/admin\/pos\/cash-sessions\/([^/]+)\/close\/?$/);
  if (cashSessionClosingMatch) {
    return <CashSessionClosingPage sessionId={cashSessionClosingMatch[1]!} />;
  }
  const cashSessionDetailMatch = pathname.match(/^\/admin\/pos\/cash-sessions\/([^/]+)\/?$/);
  if (cashSessionDetailMatch) {
    return <CashSessionDetailPage sessionId={cashSessionDetailMatch[1]!} />;
  }
  if (
    pathname.startsWith("/admin/stored-value") ||
    pathname.startsWith("/admin/gift-cards") ||
    pathname.startsWith("/admin/customer-credit") ||
    (pathname.startsWith("/admin/pos/orders/") &&
      (pathname.endsWith("/stored-value") || pathname.endsWith("/gift-card")))
  )
    return <Sprint10Screen pathname={pathname} />;
  if (isWave5InventoryPath(pathname)) return <Sprint19Wave5Inventory pathname={pathname} />;
  if (pathname.startsWith("/admin/inventory"))
    return <Sprint9Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/benefits") ||
    pathname.startsWith("/admin/vouchers") ||
    pathname.startsWith("/admin/loyalty") ||
    pathname.startsWith("/admin/membership") ||
    pathname.startsWith("/admin/packages") ||
    (pathname.startsWith("/admin/pos/orders/") &&
      pathname.endsWith("/benefits"))
  )
    return <Sprint8Screen pathname={pathname} />;
  if (pathname === "/admin/financial/invoices" || pathname === "/admin/financial/invoices/")
    return <InvoiceDirectoryPage />;
  if (pathname === "/admin/financial/payments" || pathname === "/admin/financial/payments/")
    return <PaymentTransactionDirectoryPage />;
  if (pathname === "/admin/financial/reconciliation" || pathname === "/admin/financial/reconciliation/")
    return <PaymentReconciliationPage />;
  if (pathname === "/admin/refunds" || pathname === "/admin/refunds/")
    return <RefundDirectoryPage />;
  if (pathname === "/admin/credit-notes" || pathname === "/admin/credit-notes/")
    return <CreditNoteDirectoryPage />;
  if (pathname === "/admin/financial/commission" || pathname === "/admin/financial/commission/")
    return <EmployeeCommissionPage />;
  if (pathname === "/admin/commission/adjustments" || pathname === "/admin/commission/adjustments/")
    return <CommissionAdjustmentsPage />;
  if (pathname === "/admin/financial/net-sales" || pathname === "/admin/financial/net-sales/")
    return <NetSalesPage />;
  const creditNotePathParts = pathname.split("/").filter(Boolean);
  if (
    creditNotePathParts[0] === "admin" &&
    creditNotePathParts[1] === "credit-notes" &&
    creditNotePathParts.length === 3 &&
    creditNotePathParts[2]
  )
    return <CreditNoteDirectoryPage />;
  const refundPathParts = pathname.split("/").filter(Boolean);
  if (
    refundPathParts[0] === "admin" &&
    refundPathParts[1] === "refunds" &&
    refundPathParts.length === 3 &&
    refundPathParts[2] &&
    refundPathParts[2] !== "new"
  )
    return <RefundDetailPage refundId={refundPathParts[2]} />;
  if (isWave2Path(pathname)) return <Sprint19Wave2Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/refunds") ||
    pathname.startsWith("/admin/credit-notes") ||
    pathname.startsWith("/admin/commission") ||
    pathname.startsWith("/admin/financial/refunds") ||
    pathname.startsWith("/admin/financial/net-sales") ||
    pathname.startsWith("/admin/financial/commission") ||
    pathname.startsWith("/admin/financial/exports")
  )
    return <Sprint7Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/pos") ||
    pathname.startsWith("/admin/financial")
  )
    return <Sprint6Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/operations") ||
    pathname.startsWith("/admin/service-sessions") ||
    (pathname.startsWith("/admin/appointments/") &&
      ["check-in", "execution", "add-service", "checkout-summary"].some(
        (part) => pathname.endsWith(`/${part}`),
      ))
  )
    return <Sprint5Screen pathname={pathname} />;
  if (pathname.startsWith("/admin/appointments"))
    return <Sprint4Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/calendar") ||
    pathname.startsWith("/admin/availability") ||
    pathname.startsWith("/admin/scheduling/blocks")
  )
    return <Sprint3Screen pathname={pathname} />;
  if (
    pathname.startsWith("/admin/catalog/services/") &&
    !pathname.endsWith("/new")
  )
    return <ServiceDetailScreen id={pathname.split("/").pop() ?? ""} />;
  if (
    pathname.startsWith("/admin/staff/") &&
    !pathname.endsWith("/new") &&
    pathname.split("/").length > 3
  )
    return <StaffDetailScreen id={pathname.split("/").pop() ?? ""} />;
  const resource = useMemo(() => resources[pathname], [pathname]);
  if (resource)
    return <ResourceScreen resource={resource} pathname={pathname} />;
  const legacy = legacyRoutes[pathname] ?? inferConfig(pathname);
  return <LegacyScreen config={legacy} pathname={pathname} />;
}

function ResourceScreen({
  resource,
  pathname,
}: {
  resource: Resource;
  pathname: string;
}) {
  const [state, setState] = useState<ApiState>("loading");
  const [rows, setRows] = useState<any[]>([]);
  const [formOpen, setFormOpen] = useState(pathname.endsWith("/new"));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setState("loading");
    setError("");
    try {
      const response = await authorizedFetch(resource.endpoint);
      if (response.status === 401 || response.status === 403) {
        setState("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          messageFor(body, "The request could not be completed."),
        );
      const value = unwrap(body);
      setRows(value);
      setState(value.length ? "ready" : "empty");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The request could not be completed.",
      );
      setState("error");
    }
  }
  useEffect(() => {
    void load();
  }, [resource.endpoint]);

  async function mutate(path: string, method: string, body?: unknown) {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const request: RequestInit = {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
      };
      if (body !== undefined) request.body = JSON.stringify(body);
      const response = await authorizedFetch(path, request);
      const result = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "PERMISSION_DENIED: You do not have permission for this action.",
        );
      if (response.status === 409)
        throw new Error(
          result.error?.code === "VERSION_CONFLICT"
            ? "VERSION_CONFLICT: This record changed. Reload and retry."
            : messageFor(
                result,
                "This operation conflicts with another change.",
              ),
        );
      if (!response.ok)
        throw new Error(
          messageFor(result, "The operation could not be completed."),
        );
      setNotice("Saved successfully.");
      setFormOpen(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not be completed.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of resource.fields ?? []) {
      const value = form.get(field.name);
      if (typeof value !== "string" || !value.trim()) continue;
      body[field.name] = ["defaultDurationMin", "capacity"].includes(field.name)
        ? Number(value)
        : value;
    }
    if (body.name && typeof body.name === "string")
      body.name = { "vi-VN": body.name, "en-US": body.name };
    await mutate(
      resource.endpoint.split("?")[0] ?? resource.endpoint,
      "POST",
      body,
    );
  }
  return (
    <main className="shell ns-data-workspace">
      <WorkspaceNav />
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">DỮ LIỆU VẬN HÀNH</p>
        <div className="title-row">
          <div>
            <h1 aria-label={resource.accessibleTitle}>{resource.title}</h1>
            <p className="hint">
              Dữ liệu được tải theo phạm vi được cấp quyền và luôn xác nhận qua máy chủ.
            </p>
          </div>
          {resource.fields?.length ? <button onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Đóng biểu mẫu" : "Thêm mới"}
          </button> : null}
        </div>
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        {state === "loading" && (
          <div role="status" className="skeleton">
            Đang tải dữ liệu an toàn…
          </div>
        )}
        {state === "forbidden" && (
          <div role="alert" className="state">
            <h2 aria-label="Permission required">Không có quyền truy cập</h2>
            <p>Vai trò hiện tại không được phép xem khu vực này.</p>
          </div>
        )}
        {state === "error" && (
          <div role="alert" className="state">
            <h2>Không thể tải dữ liệu</h2>
            <p>{error}</p>
            <button onClick={() => void load()}>Thử lại</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <h2>Chưa có dữ liệu</h2>
            <p>{resource.empty}</p>
            <button onClick={() => void load()}>Tải lại</button>
          </div>
        )}
        {error && state !== "error" && (
            <p role="alert" className="error">
            {error}
          </p>
        )}
        {formOpen && (
          <ResourceForm
            resource={resource}
            saving={saving}
            onSubmit={(event) => void create(event)}
          />
        )}
        {state === "ready" && (
          <DataTable
            rows={rows}
            resource={resource}
            onAction={(path, method, body) => void mutate(path, method, body)}
          />
        )}
        {pathname.startsWith("/admin/catalog/services") && (
          <ServiceTabs rows={rows} />
        )}
      </section>
    </main>
  );
}

function ResourceForm({
  resource,
  saving,
  onSubmit,
}: {
  resource: Resource;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!resource.fields?.length) return null;
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <h2>Thông tin tạo mới</h2>
      {resource.fields.map((field) => (
        <label key={field.name}>
          {field.label}
          <input
            name={field.name}
            type={field.type ?? "text"}
            required={field.required}
            minLength={field.required ? 1 : undefined}
          />
        </label>
      ))}
      <button type="submit" disabled={saving}>
        {saving ? "Đang lưu…" : "Tạo bản ghi"}
      </button>
      <p className="hint">
        Trường bắt buộc được kiểm tra trước khi gửi. Lỗi quyền và xung đột phiên bản
        sẽ được hiển thị để bạn xử lý an toàn.
      </p>
    </form>
  );
}

function DataTable({
  rows,
  resource,
  onAction,
}: {
  rows: any[];
  resource: Resource;
  onAction: (path: string, method: string, body?: unknown) => void;
}) {
  const columns = inferredColumns(rows, resource.columns);
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{resource.title}</caption>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.name} scope="col">{column.label}</th>)}
            {resource.actions?.length || resource.title === "Danh mục dịch vụ" || resource.title === "Danh sách nhân sự" ? <th scope="col">Thao tác</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = String(row.id ?? row.staffId ?? row.code ?? index);
            return (
              <tr key={String(id)}>
                {columns.map((column) => <td key={column.name} data-label={column.label}>{column.name === "code" || column.name === "employeeCode" ? <strong>{displayValue(row[column.name], column.name)}</strong> : displayValue(row[column.name], column.name)}</td>)}
                {(resource.actions?.length || resource.title === "Danh mục dịch vụ" || resource.title === "Danh sách nhân sự") ? <td className="actions">
                  {resource.title === "Nhóm dịch vụ" && (
                    <button
                      onClick={() =>
                        onAction("/v1/service-categories/reorder", "POST", {
                          categoryIds: rows.map((item) => item.id),
                        })
                      }
                    >
                      Sắp xếp
                    </button>
                  )}
                  {resource.actions?.map((action) => (
                    <button
                      key={action.label}
                      onClick={() =>
                        onAction(
                          action.path(id),
                          "POST",
                          action.label === "Từ chối"
                            ? { reviewNote: "Từ chối sau khi rà soát." }
                            : undefined,
                        )
                      }
                    >
                      {action.label}
                    </button>
                  ))}
                  {resource.title === "Danh mục dịch vụ" && (
                    <a href={`/admin/catalog/services/${id}`}>Mở chi tiết</a>
                  )}
                  {resource.title === "Danh sách nhân sự" && (
                    <a href={`/admin/staff/${id}`}>Mở hồ sơ</a>
                  )}
                </td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServiceTabs({ rows }: { rows: any[] }) {
  return <div className="tabs ns-domain-tabs" role="tablist" aria-label="Các phần của dịch vụ">
    <span role="tab" aria-selected="true">Tổng quan</span>
    <span role="tab">Bảng giá ({rows.length})</span>
    <span role="tab">Kỹ năng</span>
    <span role="tab">Tài nguyên</span>
    <span role="tab">Dịch vụ bổ sung</span>
  </div>;
}

function ObjectTable({ rows, title }: { rows: any[]; title: string }) {
  const columns = inferredColumns(rows);
  if (!columns.length) return <div className="state"><p>Chưa có dữ liệu chi tiết.</p></div>;
  return <div className="table-wrap">
    <table>
      <caption className="sr-only">{title}</caption>
      <thead><tr>{columns.map((column) => <th key={column.name} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.code ?? index)}>{columns.map((column) => <td key={column.name} data-label={column.label}>{displayValue(row[column.name], column.name)}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function DetailGrid({ value }: { value: any }) {
  if (!value || typeof value !== "object") return <div className="state"><p>Chưa có thông tin chi tiết.</p></div>;
  const fields = inferredColumns([value], undefined).slice(0, 8);
  return <dl className="ns-detail-grid">{fields.map((field) => <div key={field.name}><dt>{field.label}</dt><dd>{displayValue(value[field.name], field.name)}</dd></div>)}</dl>;
}

function ServiceDetailScreen({ id }: { id: string }) {
  const [service, setService] = useState<any>();
  const [tab, setTab] = useState("General");
  const [data, setData] = useState<any[]>([]);
  const [state, setState] = useState<ApiState>("loading");
  const tabs: Record<string, { label: string; endpoint: string }> = {
    Pricing: { label: "Bảng giá", endpoint: `/v1/services/${id}/prices` },
    Skills: { label: "Kỹ năng", endpoint: `/v1/services/${id}/skills` },
    Resources: { label: "Tài nguyên", endpoint: `/v1/services/${id}/resources` },
    "Add-ons": { label: "Dịch vụ bổ sung", endpoint: `/v1/services/${id}/addons` },
  };
  const load = async (path: string) => {
    setState("loading");
    try {
      const response = await authorizedFetch(path);
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(messageFor(body, "Unable to load"));
      const value = unwrap(body);
      setData(value);
      setState(value.length ? "ready" : "empty");
    } catch {
      setState("error");
    }
  };
  useEffect(() => {
    void (async () => {
      const response = await authorizedFetch(`/v1/services/${id}`);
      if (!response.ok) {
        setState(response.status === 403 ? "forbidden" : "error");
        return;
      }
      const body = await response.json();
      setService(body.data);
      setData([body.data]);
      setState("ready");
    })();
  }, [id]);
  return (
    <main className="shell">
      <WorkspaceNav />
      <section className="card">
        <p className="eyebrow">DANH MỤC DỊCH VỤ</p>
        <h1>{service?.name?.["vi-VN"] ?? service?.code ?? "Chi tiết dịch vụ"}</h1>
        <p className="hint">Quản lý cấu hình, bảng giá và năng lực phục vụ của dịch vụ từ dữ liệu máy chủ.</p>
        <div className="tabs ns-domain-tabs" role="tablist" aria-label="Các phần của dịch vụ">
          <button
            role="tab"
            aria-selected={tab === "General"}
            onClick={() => {
              setTab("General");
              setData(service ? [service] : []);
              setState("ready");
            }}
          >
            Tổng quan
          </button>
          {Object.entries(tabs).map(([name, config]) => (
            <button
              role="tab"
              aria-selected={tab === name}
              key={name}
              onClick={() => {
                setTab(name);
                void load(config.endpoint);
              }}
            >
              {config.label}
            </button>
          ))}
        </div>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Đang tải {tab === "General" ? "tổng quan" : tabs[tab]?.label.toLowerCase()}…
          </div>
        )}
        {state === "forbidden" && <p role="alert">Permission denied.</p>}
        {state === "error" && (
          <p role="alert">
            Unable to load this tab. Retry by selecting it again.
          </p>
        )}
        {state === "empty" && <p>Chưa có dữ liệu cho phần này.</p>}
        {state === "ready" && (tab === "General" ? <DetailGrid value={service} /> : <ObjectTable rows={data} title={tabs[tab]?.label ?? tab} />)}
        <a href="/admin/catalog/services">Quay lại danh mục dịch vụ</a>
      </section>
    </main>
  );
}

function StaffDetailScreen({ id }: { id: string }) {
  const [staff, setStaff] = useState<any>();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [availableBranches, setAvailableBranches] = useState<any[]>([]);
  const [availableSkills, setAvailableSkills] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [message, setMessage] = useState("");
  const intentKeys = useRef<Record<string, string>>({});
  async function load() {
    const responses = await Promise.all([
      authorizedFetch(`/v1/staff/${id}`),
      authorizedFetch(`/v1/staff/${id}/branches`),
      authorizedFetch(`/v1/staff/${id}/skills`),
      authorizedFetch("/v1/branches"),
      authorizedFetch("/v1/skills"),
    ]);
    const bodies = await Promise.all(responses.map(async (response) => response.json().catch(() => ({}))));
    if (!responses[0]!.ok) {
      setMessage("Không thể tải hồ sơ nhân sự.");
      return;
    }
    setStaff(bodies[0]!.data);
    setAssignments(unwrap(bodies[1]));
    setSkills(unwrap(bodies[2]));
    setAvailableBranches(responses[3]!.ok ? unwrap(bodies[3]) : []);
    setAvailableSkills(responses[4]!.ok ? unwrap(bodies[4]) : []);
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function assign() {
    if (!selectedBranchId) return;
    const key = intentKeys.current.branch ?? (intentKeys.current.branch = crypto.randomUUID());
    try {
      const response = await authorizedFetch(`/v1/staff/${id}/branches`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          branchId: selectedBranchId,
          effectiveFrom: new Date().toISOString().slice(0, 10),
          isPrimary: false,
          canBeBooked: true,
        }),
      });
      setMessage(response.ok ? "Đã lưu phân công chi nhánh." : "Phân công bị từ chối hoặc xung đột.");
      if (response.ok) {
        delete intentKeys.current.branch;
        setSelectedBranchId("");
        await load();
      }
    } catch {
      setMessage("Không thể lưu phân công chi nhánh.");
    }
  }
  async function assignSkill() {
    if (!selectedSkillId) return;
    const key = intentKeys.current.skill ?? (intentKeys.current.skill = crypto.randomUUID());
    try {
      const response = await authorizedFetch(`/v1/staff/${id}/skills`, {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ skills: [{ skillId: selectedSkillId, proficiencyLevel: "STANDARD" }] }),
      });
      setMessage(response.ok ? "Đã lưu kỹ năng nhân sự." : "Không thể lưu kỹ năng nhân sự.");
      if (response.ok) {
        delete intentKeys.current.skill;
        setSelectedSkillId("");
        await load();
      }
    } catch {
      setMessage("Không thể lưu kỹ năng nhân sự.");
    }
  }
  return (
    <main className="shell ns-detail-workspace">
      <WorkspaceNav />
      <section className="card">
        <p className="eyebrow">HỒ SƠ NHÂN SỰ</p>
        <h1>{staff?.displayName ?? "Chi tiết nhân sự"}</h1>
        <p className="hint">Hồ sơ, phân công và kỹ năng được tách thành các vùng thao tác để dễ rà soát.</p>
        {message && <p role="status">{message}</p>}
        <div className="tabs ns-domain-tabs" role="tablist" aria-label="Các phần của hồ sơ nhân sự">
          <span role="tab" aria-selected="true">Tổng quan</span>
          <span role="tab">Chi nhánh ({assignments.length})</span>
          <span role="tab">Kỹ năng ({skills.length})</span>
          <span role="tab">Ca sắp tới</span>
          <span role="tab">Nghỉ phép</span>
        </div>
        <DetailGrid value={staff} />
        <div className="ns-detail-columns">
          <section className="ns-subcard">
            <div className="title-row"><div><h2>Phân công chi nhánh</h2><p className="hint">Chọn từ danh sách chi nhánh được máy chủ trả về.</p></div></div>
            {availableBranches.length ? <form className="ns-inline-form" onSubmit={(event) => { event.preventDefault(); void assign(); }}>
              <label>Chi nhánh<select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} required><option value="">Chọn chi nhánh</option>{availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{displayValue(branch.name ?? branch.displayName ?? branch.code)}</option>)}</select></label>
              <button type="submit">Gán chi nhánh</button>
            </form> : <p className="hint">Danh sách chi nhánh không khả dụng với quyền hiện tại.</p>}
            <ObjectTable rows={assignments} title="Phân công chi nhánh" />
          </section>
          <section className="ns-subcard">
            <div className="title-row"><div><h2>Kỹ năng</h2><p className="hint">Mức kỹ năng được lưu qua workflow của nhân sự.</p></div></div>
            {availableSkills.length ? <form className="ns-inline-form" onSubmit={(event) => { event.preventDefault(); void assignSkill(); }}>
              <label>Kỹ năng<select value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)} required><option value="">Chọn kỹ năng</option>{availableSkills.map((skill) => <option key={skill.id} value={skill.id}>{displayValue(skill.name ?? skill.displayName ?? skill.code)}</option>)}</select></label>
              <button type="submit">Gán kỹ năng</button>
            </form> : <p className="hint">Danh sách kỹ năng không khả dụng với quyền hiện tại.</p>}
            <ObjectTable rows={skills} title="Kỹ năng nhân sự" />
          </section>
        </div>
        <a href="/admin/staff/list">Quay lại danh sách nhân sự</a>
      </section>
    </main>
  );
}

function LegacyScreen({
  config,
  pathname,
}: {
  config: { title: string; accessibleTitle?: string; endpoint?: string; empty: string };
  pathname?: string;
}) {
  const [state, setState] = useState<ApiState>("loading");
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");
  async function load() {
    if (!config.endpoint) {
      setState("empty");
      return;
    }
    setState("loading");
    try {
      const response = await authorizedFetch(config.endpoint);
      if (response.status === 401 || response.status === 403) {
        setState("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(messageFor(body, "Unable to load"));
      const value = unwrap(body);
      setData(value);
      setState(value.length ? "ready" : "empty");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load");
      setState("error");
    }
  }
  useEffect(() => {
    void load();
  }, [config.endpoint]);
  return (
    <main className="shell ns-data-workspace">
      <WorkspaceNav />
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">KHU VỰC QUẢN TRỊ</p>
        <h1 aria-label={config.accessibleTitle}>{config.title}</h1>
        <p className="hint">Màn hình này hiển thị dữ liệu thật theo quyền truy cập hiện tại.</p>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Đang tải dữ liệu an toàn…
          </div>
        )}
        {state === "forbidden" && (
          <div role="alert" className="state">
            <h2 aria-label="Permission required">Cần được cấp quyền</h2>
            <p>Vai trò hiện tại không được phép xem khu vực này.</p>
          </div>
        )}
        {state === "error" && (
          <div role="alert" className="state">
            <p>{error}</p>
            <button onClick={() => void load()}>Thử lại</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <p>{config.empty}</p>
            <button onClick={() => void load()}>Tải lại</button>
          </div>
        )}
        {state === "ready" && <ObjectTable rows={data} title={config.title} />}
        {pathname?.endsWith("/branches/new") && <p className="hint">Tạo chi nhánh được thực hiện trong quy trình cấu hình chi nhánh được cấp quyền.</p>}
      </section>
    </main>
  );
}

function WorkspaceNav() {
  return null;
}
function inferConfig(pathname: string) {
  if (pathname.endsWith("/branches/new"))
    return {
      title: "Thêm chi nhánh",
      accessibleTitle: "Create branch",
      endpoint: "/v1/branches",
      empty: "Hoàn tất thông tin để thêm chi nhánh.",
    };
  if (pathname.includes("/branches/"))
    return {
      title: pathname.endsWith("/hours") ? "Giờ hoạt động" : "Chi tiết chi nhánh",
      endpoint: "/v1/branches",
      empty: "Không có dữ liệu chi nhánh.",
    };
  if (pathname.includes("/team/users/"))
    return {
      title: pathname.endsWith("/sessions") ? "Phiên người dùng" : "Chi tiết tài khoản",
      endpoint: "/v1/users",
      empty: "Không có dữ liệu tài khoản.",
    };
  return { title: "Khu vực quản trị", empty: "Chưa có dữ liệu trong phạm vi này." };
}
