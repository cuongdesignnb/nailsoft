/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
import PosStoredValueWorkspace from "./pos/pos-stored-value-workspace";
import InvoiceDirectoryPage from "./financial/invoice-directory-page";
import PaymentTransactionDirectoryPage from "./financial/payment-directory-page";
import PaymentReconciliationPage from "./financial/payment-reconciliation-page";
import RefundDirectoryPage from "./financial/refund-directory-page";
import RefundDetailPage from "./financial/refund-detail-page";
import CreditNoteDirectoryPage from "./financial/credit-note-directory-page";
import EmployeeCommissionPage from "./financial/employee-commission-page";
import CommissionAdjustmentsPage from "./financial/commission-adjustments-page";
import NetSalesPage from "./financial/net-sales-page";
import WorkforceHub from "./workforce-hubs";
import AdminControlHub from "./admin-control-hubs";
import CatalogHub from "./catalog-hubs";
import OrganizationHub from "./organization-hub";

type Resource = {
  title: string;
  endpoint: string;
  empty: string;
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
    title: "Service categories",
    endpoint: "/v1/service-categories",
    empty: "Create the first service category.",
    fields: [
      { name: "code", label: "Code", required: true },
      { name: "name", label: "Name (vi-VN)", required: true },
    ],
    actions: [
      {
        label: "Archive",
        path: (id) => `/v1/service-categories/${id}/archive`,
      },
    ],
  },
  "/admin/catalog/services": {
    title: "Service catalog",
    endpoint: "/v1/services?status=ACTIVE&page=1&pageSize=50",
    empty: "No active services are configured.",
    fields: [
      { name: "categoryId", label: "Category ID", required: true },
      { name: "code", label: "Code", required: true },
      { name: "name", label: "Name (vi-VN)", required: true },
      {
        name: "defaultDurationMin",
        label: "Duration (minutes)",
        type: "number",
        required: true,
      },
    ],
    actions: [{ label: "Archive", path: (id) => `/v1/services/${id}/archive` }],
  },
  "/admin/catalog/skills": {
    title: "Skills",
    endpoint: "/v1/skills",
    empty: "No skills are configured.",
    fields: [
      { name: "code", label: "Code", required: true },
      { name: "name", label: "Name (vi-VN)", required: true },
    ],
    actions: [{ label: "Archive", path: (id) => `/v1/skills/${id}/archive` }],
  },
  "/admin/catalog/resource-types": {
    title: "Resource types",
    endpoint: "/v1/resource-types",
    empty: "No resource types are configured.",
    fields: [
      { name: "code", label: "Code", required: true },
      { name: "name", label: "Name (vi-VN)", required: true },
    ],
  },
  "/admin/catalog/resources": {
    title: "Branch resources",
    endpoint: "/v1/resources",
    empty: "No branch resources are configured.",
    fields: [
      { name: "branchId", label: "Branch ID", required: true },
      { name: "resourceTypeId", label: "Resource type ID", required: true },
      { name: "code", label: "Code", required: true },
      { name: "name", label: "Name", required: true },
      { name: "capacity", label: "Capacity", type: "number", required: true },
    ],
    actions: [
      { label: "Archive", path: (id) => `/v1/resources/${id}/archive` },
    ],
  },
  "/admin/staff/list": {
    title: "Staff profiles",
    endpoint: "/v1/staff",
    empty: "No staff profiles match the current filters.",
    fields: [
      { name: "employeeCode", label: "Employee code", required: true },
      { name: "displayName", label: "Display name", required: true },
      { name: "membershipId", label: "Membership ID" },
    ],
  },
  "/admin/staff/new": {
    title: "Create staff profile",
    endpoint: "/v1/staff",
    empty: "Complete the profile to create a staff member.",
    fields: [
      { name: "employeeCode", label: "Employee code", required: true },
      { name: "displayName", label: "Display name", required: true },
      { name: "membershipId", label: "Membership ID" },
    ],
  },
  "/admin/scheduling/shifts": {
    title: "Shift planner",
    endpoint: "/v1/shifts",
    empty: "No shifts have been created.",
    fields: [
      { name: "branchId", label: "Branch ID", required: true },
      { name: "staffId", label: "Staff ID", required: true },
      {
        name: "startAt",
        label: "Start",
        type: "datetime-local",
        required: true,
      },
      { name: "endAt", label: "End", type: "datetime-local", required: true },
    ],
    actions: [
      { label: "Publish", path: (id) => `/v1/shifts/${id}/publish` },
      { label: "Cancel", path: (id) => `/v1/shifts/${id}/cancel` },
    ],
  },
  "/admin/scheduling/leave-requests": {
    title: "Leave review",
    endpoint: "/v1/leave-requests",
    empty: "No leave requests are pending.",
    actions: [
      { label: "Approve", path: (id) => `/v1/leave-requests/${id}/approve` },
      { label: "Reject", path: (id) => `/v1/leave-requests/${id}/reject` },
      { label: "Cancel", path: (id) => `/v1/leave-requests/${id}/cancel` },
    ],
  },
};

const legacyRoutes: Record<
  string,
  { title: string; endpoint?: string; empty: string }
> = {
  "/admin/dashboard": {
    title: "Salon overview",
    endpoint: "/v1/organization",
    empty: "No organization data is available.",
  },
  "/admin/organization/general": {
    title: "Organization",
    endpoint: "/v1/organization",
    empty: "Organization settings are empty.",
  },
  "/admin/organization/branches": {
    title: "Branches",
    endpoint: "/v1/branches",
    empty: "Create the first branch to get started.",
  },
  "/admin/team/users": {
    title: "Team",
    endpoint: "/v1/users",
    empty: "No team members match the current filters.",
  },
  "/admin/security/sessions": {
    title: "My active sessions",
    endpoint: "/v1/auth/sessions",
    empty: "No active sessions.",
  },
};

function messageFor(body: any, fallback: string) {
  return body?.error?.message ?? body?.message ?? fallback;
}
function unwrap(body: any): any[] {
  const value = body?.data;
  return Array.isArray(value) ? value : value ? [value] : [];
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
  if (pathname === "/admin/organization/general") return <OrganizationHub />;
  if (pathname.startsWith("/admin/organization/branches") || pathname.startsWith("/admin/team/users") || pathname === "/admin/security/sessions")
    return <AdminControlHub pathname={pathname} />;
  if (pathname.startsWith("/admin/catalog/")) return <CatalogHub pathname={pathname} />;
  if (pathname.startsWith("/admin/assets")) return <Sprint16Screen />;
  if (isWave5ProcurementPath(pathname)) return <Sprint19Wave5Procurement pathname={pathname} />;
  if (pathname.startsWith("/admin/procurement")) return <Sprint15Screen />;
  if (pathname.startsWith("/admin/accounting")) return <Sprint14Screen />;
  if (pathname.startsWith("/admin/billing") || pathname.startsWith("/admin/support-access"))
    return <Sprint13Screen />;
  if (isWave4Path(pathname)) return <Sprint19Wave4Screen pathname={pathname} />;
  if (pathname === "/admin/staff/list" || pathname === "/admin/time-clock" || pathname === "/admin/payroll/runs" || /^\/admin\/payroll\/runs\/[^/]+$/.test(pathname))
    return <WorkforceHub pathname={pathname} />;
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
  const posStoredValueMatch = pathname.match(/^\/admin\/pos\/orders\/([^/]+)\/(stored-value|gift-card)$/);
  if (posStoredValueMatch) {
    return <PosStoredValueWorkspace orderId={posStoredValueMatch[1]!} mode={posStoredValueMatch[2] as "stored-value" | "gift-card"} />;
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
    <main className="shell">
      <WorkspaceNav />
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">NAILSOFT · VẬN HÀNH</p>
        <div className="title-row">
          <div>
            <h1>{legacyTitle(resource.title)}</h1>
            <p className="hint">
              Thay đổi theo tenant được audit và an toàn khi thử lại.
            </p>
          </div>
          <button onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Đóng biểu mẫu" : "Tạo mới"}
          </button>
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
            <h2>Không có quyền truy cập</h2>
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
            <p>{legacyMessage(resource.empty)}</p>
            <button onClick={() => void load()}>Làm mới</button>
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
      <h2>Biểu mẫu tạo có kiểm tra</h2>
      {resource.fields.map((field) => (
        <label key={field.name}>
          {legacyFieldLabel(field.label)}
          <input
            name={field.name}
            type={field.type ?? "text"}
            required={field.required}
            minLength={field.required ? 1 : undefined}
          />
        </label>
      ))}
      <button type="submit" disabled={saving}>
        {saving ? "Đang lưu…" : "Lưu"}
      </button>
      <p className="hint">
        Trường bắt buộc được kiểm tra trước khi gửi. Xung đột phiên bản và lỗi quyền sẽ hiển thị tại đây.
      </p>
    </form>
  );
}

type LegacyColumn = { key: string; label: string };

function legacyTitle(value: string) {
  const labels: Record<string, string> = {
    "Salon overview": "Tổng quan salon",
    Organization: "Thông tin tổ chức",
    Branches: "Chi nhánh",
    Team: "Đội ngũ",
    "My active sessions": "Phiên đăng nhập của tôi",
    "Service categories": "Nhóm dịch vụ",
    "Service catalog": "Danh mục dịch vụ",
    Skills: "Kỹ năng",
    "Resource types": "Loại tài nguyên",
    "Branch resources": "Tài nguyên chi nhánh",
    "Staff profiles": "Hồ sơ nhân sự",
    "Create staff profile": "Tạo hồ sơ nhân sự",
    "Shift planner": "Lập lịch ca",
    "Leave review": "Duyệt đơn nghỉ",
  };
  return labels[value] ?? value;
}
function legacyFieldLabel(value: string) {
  const labels: Record<string, string> = {
    Code: "Mã", Name: "Tên", "Name (vi-VN)": "Tên hiển thị", "Category ID": "Nhóm dịch vụ",
    "Duration (minutes)": "Thời lượng (phút)", "Branch ID": "Chi nhánh", "Resource type ID": "Loại tài nguyên",
    Capacity: "Sức chứa", "Employee code": "Mã nhân sự", "Display name": "Tên hiển thị", "Membership ID": "Membership",
    Start: "Bắt đầu", End: "Kết thúc", "Command payload (validated by API)": "Dữ liệu lệnh (được API kiểm tra)",
  };
  return labels[value] ?? value;
}
function legacyMessage(value: string) {
  const labels: Record<string, string> = {
    "Create the first service category.": "Hãy tạo nhóm dịch vụ đầu tiên.",
    "No active services are configured.": "Chưa có dịch vụ đang hoạt động.",
    "No skills are configured.": "Chưa có kỹ năng được cấu hình.",
    "No resource types are configured.": "Chưa có loại tài nguyên.",
    "No branch resources are configured.": "Chưa có tài nguyên chi nhánh.",
    "No staff profiles match the current filters.": "Chưa có hồ sơ nhân sự phù hợp.",
    "Complete the profile to create a staff member.": "Hoàn tất hồ sơ để tạo nhân sự.",
    "No shifts have been created.": "Chưa có ca làm.",
    "No leave requests are pending.": "Không có đơn nghỉ đang chờ.",
  };
  return labels[value] ?? value;
}

function legacyColumns(pathname: string, row: any): LegacyColumn[] {
  const byPath: Record<string, LegacyColumn[]> = {
    "/admin/organization/branches": [
      { key: "name", label: "Tên chi nhánh" }, { key: "code", label: "Mã" },
      { key: "timezone", label: "Múi giờ" }, { key: "status", label: "Trạng thái" }, { key: "createdAt", label: "Ngày tạo" },
    ],
    "/admin/team/users": [
      { key: "displayName", label: "Người dùng" }, { key: "email", label: "Email" },
      { key: "locale", label: "Ngôn ngữ" }, { key: "status", label: "Trạng thái" }, { key: "roles", label: "Vai trò" },
    ],
    "/admin/security/sessions": [
      { key: "deviceName", label: "Thiết bị" }, { key: "platform", label: "Nền tảng" },
      { key: "lastSeenAt", label: "Hoạt động gần nhất" }, { key: "expiresAt", label: "Hết hạn" }, { key: "isCurrent", label: "Phiên hiện tại" },
    ],
    "/admin/organization/general": [
      { key: "name", label: "Tên tổ chức" }, { key: "slug", label: "Mã salon" },
      { key: "locale", label: "Ngôn ngữ" }, { key: "currency", label: "Tiền tệ" }, { key: "timezone", label: "Múi giờ" },
    ],
  };
  if (byPath[pathname]) return byPath[pathname]!;
  return Object.keys(row ?? {}).filter((key) => !["id", "tenantId", "tenant_id"].includes(key) && !key.toLowerCase().includes("json")).slice(0, 6).map((key) => ({ key, label: key.replaceAll("_", " ") }));
}

function legacyStatus(value: unknown) {
  const raw = String(value ?? "").toUpperCase();
  const labels: Record<string, string> = { ACTIVE: "Đang hoạt động", INACTIVE: "Không hoạt động", CURRENT: "Phiên hiện tại", REVOKED: "Đã thu hồi", EXPIRED: "Đã hết hạn", PENDING: "Đang chờ", SUSPENDED: "Tạm ngưng", CANCELLED: "Đã hủy", PUBLISHED: "Đã công bố", DRAFT: "Bản nháp", ANNUAL: "Nghỉ phép năm", SICK: "Nghỉ ốm", UNPAID: "Nghỉ không lương", STANDARD: "Tiêu chuẩn" };
  return labels[raw] ?? (raw ? raw.replaceAll("_", " ") : "—");
}

function legacyValue(value: unknown, key: string) {
  if (value == null || value === "") return "—";
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  if (key === "id" || key.endsWith("Id") || key.endsWith("ID") || normalizedKey.endsWith(" id") || normalizedKey.endsWith(" uuid")) return "Mã hệ thống";
  if (key.toLowerCase().includes("email") && typeof value === "string") {
    const [local, domain] = value.split("@");
    return domain ? `${local?.slice(0, 2) ?? ""}…@${domain}` : value;
  }
  if (key.toLowerCase().includes("status") || key.toLowerCase() === "state" || key === "isCurrent") return typeof value === "boolean" ? (value ? "Có" : "Không") : legacyStatus(value);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (Array.isArray(value)) return value.length ? `${value.length} mục` : "—";
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return String(objectValue.displayName ?? objectValue.name ?? objectValue.code ?? "Đã có dữ liệu");
  }
  if (/(At|Date|_at|_date|Start|End|From|To)$/.test(key) && !Number.isNaN(Date.parse(String(value)))) return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  return String(value);
}

function LegacyDataTable({ pathname, title, rows }: { pathname?: string | undefined; title: string; rows: any[] }) {
  const columns = legacyColumns(pathname ?? "", rows[0] ?? {});
  return <div className="table-wrap legacy-table-wrap"><table><caption className="sr-only">{title}</caption><thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? row.code ?? index}>{columns.map((column) => <td key={column.key} data-label={column.label}>{legacyValue(row[column.key], column.key)}</td>)}</tr>)}</tbody></table></div>;
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
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Bản ghi</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Phiên bản</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = row.id ?? row.staffId;
            const label =
              row.code ??
              row.displayName ??
              row.staffName ??
              row.branchName ??
              row.name?.["vi-VN"] ??
              row.name ??
              row.type ??
              row.kind ??
              (row.staffId ? "Nhân sự" : row.branchId ? "Chi nhánh" : "Mã hệ thống");
            return (
              <tr key={id}>
                <td data-label="Bản ghi">
                  <strong>{label}</strong>
                  <small>Mã hệ thống</small>
                </td>
                <td data-label="Trạng thái">{legacyStatus(row.status ?? "ACTIVE")}</td>
                <td data-label="Phiên bản">{row.version ?? "—"}</td>
                <td data-label="Thao tác" className="actions">
                  {resource.fields?.length && id && (
                    <button
                      onClick={() => {
                        const field = resource.fields?.[0]?.name;
                        const value = field
                          ? window.prompt(
                              `Nhập ${field}`,
                              String(row[field] ?? ""),
                            )
                          : null;
                        if (field && value !== null && value.trim())
                          onAction(
                            `/v1/${resource.title === "Staff profiles" ? "staff" : resource.title === "Service catalog" ? "services" : resource.title === "Service categories" ? "service-categories" : resource.title.toLowerCase().replaceAll(" ", "-")}/${id}`,
                            "PATCH",
                            { [field]: value, version: row.version },
                          );
                      }}
                    >
                      Chỉnh sửa
                    </button>
                  )}
                  {resource.title === "Service categories" && (
                    <button
                      onClick={() =>
                        onAction("/v1/service-categories/reorder", "POST", {
                          categoryIds: rows.map((item) => item.id),
                        })
                      }
                    >
                      Sắp xếp lại
                    </button>
                  )}
                  {resource.actions?.map((action) => (
                    <button
                      key={action.label}
                      onClick={() =>
                        onAction(
                          action.path(id),
                          "POST",
                          action.label === "Reject"
                            ? { reviewNote: "Rejected by reviewer" }
                            : undefined,
                        )
                      }
                    >
                      {{ Archive: "Lưu trữ", Publish: "Công bố", Cancel: "Hủy", Approve: "Phê duyệt", Reject: "Từ chối" }[action.label] ?? action.label}
                    </button>
                  ))}
                  {resource.title === "Service catalog" && (
                    <a href={`/admin/catalog/services/${id}`}>Mở các mục</a>
                  )}
                  {resource.title === "Staff profiles" && (
                    <a href={`/admin/staff/${id}`}>Phân công & kỹ năng</a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServiceTabs({ rows }: { rows: any[] }) {
  return (
    <div className="tabs" role="tablist">
      <span role="tab" aria-selected="true">
        Thông tin chung
      </span>
      <span role="tab">Bảng giá ({rows.length})</span>
      <span role="tab">Kỹ năng</span>
      <span role="tab">Tài nguyên</span>
      <span role="tab">Dịch vụ bổ sung</span>
    </div>
  );
}

function ServiceDetailScreen({ id }: { id: string }) {
  const [service, setService] = useState<any>();
  const [tab, setTab] = useState("General");
  const [data, setData] = useState<any[]>([]);
  const [state, setState] = useState<ApiState>("loading");
  const tabs: Record<string, string> = {
    Pricing: `/v1/services/${id}/prices`,
    Skills: `/v1/services/${id}/skills`,
    Resources: `/v1/services/${id}/resources`,
    "Add-ons": `/v1/services/${id}/addons`,
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
        <p className="eyebrow">NAILSOFT · DANH MỤC DỊCH VỤ</p>
        <h1>{service?.name?.["vi-VN"] ?? service?.code ?? "Chi tiết dịch vụ"}</h1>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "General"}
            onClick={() => {
              setTab("General");
              setData(service ? [service] : []);
              setState("ready");
            }}
          >
            Thông tin chung
          </button>
          {Object.keys(tabs).map((name) => (
            <button
              role="tab"
              aria-selected={tab === name}
              key={name}
              onClick={() => {
                setTab(name);
                void load(tabs[name] ?? "");
              }}
            >
              {{ Pricing: "Bảng giá", Skills: "Kỹ năng", Resources: "Tài nguyên", "Add-ons": "Dịch vụ bổ sung" }[name] ?? name}
            </button>
          ))}
        </div>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Đang tải {tab === "General" ? "thông tin chung" : tab.toLowerCase()}…
          </div>
        )}
        {state === "forbidden" && <p role="alert">Không có quyền truy cập.</p>}
        {state === "error" && (
          <p role="alert">
            Không thể tải mục này. Hãy chọn lại để thử.
          </p>
        )}
        {state === "empty" && <p>Chưa có dữ liệu {tab.toLowerCase()}.</p>}
        {state === "ready" && (
          <LegacyDataTable title={tab === "General" ? "Thông tin chung" : tab} rows={data} />
        )}
        <a href="/admin/catalog/services">Quay lại danh mục dịch vụ</a>
      </section>
    </main>
  );
}

function StaffDetailScreen({ id }: { id: string }) {
  const [staff, setStaff] = useState<any>();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [branchOptions, setBranchOptions] = useState<any[]>([]);
  const [skillOptions, setSkillOptions] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [profile, branchRows, skillRows, branchDirectory, skillDirectory] = await Promise.all([
      authorizedFetch(`/v1/staff/${id}`),
      authorizedFetch(`/v1/staff/${id}/branches`),
      authorizedFetch(`/v1/staff/${id}/skills`),
      authorizedFetch("/v1/branches"),
      authorizedFetch("/v1/skills"),
    ]);
    if (!profile.ok) {
      setMessage("Unable to load staff profile.");
      return;
    }
    setStaff((await profile.json()).data);
    setAssignments((await branchRows.json()).data ?? []);
    setSkills((await skillRows.json()).data ?? []);
    setBranchOptions(unwrap(await branchDirectory.json()));
    setSkillOptions(unwrap(await skillDirectory.json()));
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function assign() {
    if (!selectedBranchId) return;
    const response = await authorizedFetch(`/v1/staff/${id}/branches`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        branchId: selectedBranchId,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        isPrimary: false,
        canBeBooked: true,
      }),
    });
    setMessage(
      response.ok
        ? "Branch assignment saved."
        : "Assignment conflict or permission denied.",
    );
    await load();
  }
  async function assignSkill() {
    if (!selectedSkillId) return;
    const response = await authorizedFetch(`/v1/staff/${id}/skills`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        skills: [{ skillId: selectedSkillId, proficiencyLevel: "STANDARD" }],
      }),
    });
    setMessage(
      response.ok ? "Skill assignment saved." : "Skill assignment failed.",
    );
    await load();
  }
  return (
    <main className="shell">
      <WorkspaceNav />
      <section className="card">
        <p className="eyebrow">NAILSOFT · HỒ SƠ NHÂN SỰ</p>
        <h1>{staff?.displayName ?? "Chi tiết nhân sự"}</h1>
        {message && <p role="status">{message}</p>}
        <div className="tabs">
          <span>Thông tin chung</span>
          <span>Chi nhánh ({assignments.length})</span>
          <span>Kỹ năng ({skills.length})</span>
          <span>Ca sắp tới</span>
          <span>Đơn nghỉ</span>
        </div>
        <div className="legacy-profile-grid">
          <article className="legacy-profile-card"><span>Mã nhân sự</span><strong>{staff?.employeeCode ?? "—"}</strong><small>{staff?.employmentType ?? "—"}</small></article>
          <article className="legacy-profile-card"><span>Ngôn ngữ</span><strong>{staff?.preferredLocale ?? "vi-VN"}</strong><small>{staff?.status ?? "—"}</small></article>
        </div>
        <div className="actions">
          <label>Gán chi nhánh<select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}><option value="">Chọn chi nhánh</option>{branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name ?? branch.displayName ?? branch.code}</option>)}</select></label>
          <button onClick={() => void assign()} disabled={!selectedBranchId}>Gán chi nhánh</button>
          <label>Gán kỹ năng<select value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)}><option value="">Chọn kỹ năng</option>{skillOptions.map((skill) => <option key={skill.id} value={skill.id}>{skill.name?.["vi-VN"] ?? skill.name ?? skill.code}</option>)}</select></label>
          <button onClick={() => void assignSkill()} disabled={!selectedSkillId}>Gán kỹ năng</button>
        </div>
        <h2>Phân công chi nhánh</h2>
        <LegacyDataTable title="Phân công chi nhánh" rows={assignments} />
        <h2>Kỹ năng</h2>
        <LegacyDataTable title="Kỹ năng" rows={skills} />
        <a href="/admin/staff/list">Quay lại danh sách nhân sự</a>
      </section>
    </main>
  );
}

function LegacyScreen({
  config,
  pathname,
}: {
  config: { title: string; endpoint?: string; empty: string };
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
    <main className="shell ops-shell">
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">NAILSOFT · QUẢN TRỊ</p>
        <h1>{legacyTitle(config.title)}</h1>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Đang tải dữ liệu an toàn…
          </div>
        )}
        {state === "forbidden" && (
          <div role="alert" className="state">
            <h2>Cần có quyền truy cập</h2>
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
            <button onClick={() => void load()}>Làm mới</button>
          </div>
        )}
        {state === "ready" && (pathname === "/admin/profile" ? <ProfileOverview value={data[0]} /> : <LegacyDataTable pathname={pathname} title={legacyTitle(config.title)} rows={data} />)}
        {pathname?.endsWith("/branches/new") && (
          <form
            className="form-grid"
            onSubmit={(event) => event.preventDefault()}
          >
            <h2>Create branch</h2>
            <label>
              Name
              <input required minLength={1} />
            </label>
            <label>
              Code
              <input required minLength={1} />
            </label>
            <button type="submit">Review</button>
          </form>
        )}
      </section>
    </main>
  );
}

function ProfileOverview({ value }: { value: any }) {
  const user = value?.user ?? {};
  const workspace = value?.workspace ?? {};
  const authorization = value?.authorization ?? {};
  const permissions = Array.isArray(authorization.permissions) ? authorization.permissions : [];
  const roles = Array.isArray(authorization.roles) ? authorization.roles : [];
  return <div className="legacy-profile-grid">
    <article className="legacy-profile-card"><span>Người dùng</span><strong>{user.displayName ?? user.email ?? "—"}</strong><small>{user.email ?? "—"}</small></article>
    <article className="legacy-profile-card"><span>Không gian làm việc</span><strong>{workspace.tenantName ?? "—"}</strong><small>{workspace.tenantSlug ?? workspace.tenantId ?? "—"}</small></article>
    <article className="legacy-profile-card"><span>Quyền truy cập</span><strong>{roles.join(", ") || "—"}</strong><small>{permissions.length} quyền được cấp · Chế độ {workspace.accessMode ?? "—"}</small></article>
    <article className="legacy-profile-card"><span>Ngôn ngữ & tiền tệ</span><strong>{workspace.locale ?? "vi-VN"}</strong><small>{workspace.currency ?? "—"} · {workspace.timezone ?? "—"}</small></article>
  </div>;
}

function WorkspaceNav() {
  return (
    <nav className="topbar">
      <a href="/admin/dashboard">Nailsoft</a>
      <a href="/admin/catalog/categories">Nhóm dịch vụ</a>
      <a href="/admin/catalog/services">Dịch vụ</a>
      <a href="/admin/catalog/skills">Kỹ năng</a>
      <a href="/admin/catalog/resources">Tài nguyên</a>
      <a href="/admin/staff/list">Nhân sự</a>
      <a href="/admin/scheduling/shifts">Ca làm</a>
      <a href="/admin/scheduling/leave-requests">Đơn nghỉ</a>
    </nav>
  );
}
function inferConfig(pathname: string) {
  if (pathname === "/admin/profile")
    return {
      title: "Hồ sơ tài khoản",
      endpoint: "/v1/auth/context",
      empty: "Chưa có thông tin tài khoản.",
    };
  if (pathname.includes("/branches/"))
    return {
      title: pathname.endsWith("/hours") ? "Giờ hoạt động" : "Chi tiết chi nhánh",
      endpoint: "/v1/branches",
      empty: "Chưa có dữ liệu chi nhánh.",
    };
  if (pathname.includes("/team/users/"))
    return {
      title: pathname.endsWith("/sessions") ? "Phiên đăng nhập người dùng" : "Chi tiết người dùng",
      endpoint: "/v1/users",
      empty: "Chưa có dữ liệu người dùng.",
    };
  return { title: "Khu vực quản trị", empty: "Chưa có dữ liệu phù hợp." };
}
