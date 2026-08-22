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
    <main className="shell">
      <WorkspaceNav />
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">SPRINT 2 · OPERATIONS</p>
        <div className="title-row">
          <div>
            <h1>{resource.title}</h1>
            <p className="hint">
              Tenant-scoped changes are audited and safe to retry.
            </p>
          </div>
          <button onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Close form" : "Create"}
          </button>
        </div>
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        {state === "loading" && (
          <div role="status" className="skeleton">
            Loading securely…
          </div>
        )}
        {state === "forbidden" && (
          <div role="alert" className="state">
            <h2>Permission denied</h2>
            <p>Your role cannot access this workspace area.</p>
          </div>
        )}
        {state === "error" && (
          <div role="alert" className="state">
            <h2>Unable to load</h2>
            <p>{error}</p>
            <button onClick={() => void load()}>Retry</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <h2>Nothing here yet</h2>
            <p>{resource.empty}</p>
            <button onClick={() => void load()}>Refresh</button>
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
      <h2>Validated create form</h2>
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
        {saving ? "Saving…" : "Save"}
      </button>
      <p className="hint">
        Required fields are validated before submission. Server version
        conflicts and permission errors are shown here.
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
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Record</th>
            <th>Status</th>
            <th>Version</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = row.id ?? row.staffId;
            const label =
              row.code ??
              row.displayName ??
              row.name?.["vi-VN"] ??
              row.name ??
              id;
            return (
              <tr key={id}>
                <td>
                  <strong>{label}</strong>
                  <small>{id}</small>
                </td>
                <td>{row.status ?? "ACTIVE"}</td>
                <td>{row.version ?? "—"}</td>
                <td className="actions">
                  {resource.fields?.length && id && (
                    <button
                      onClick={() => {
                        const field = resource.fields?.[0]?.name;
                        const value = field
                          ? window.prompt(
                              `New ${field}`,
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
                      Edit
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
                      Reorder
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
                      {action.label}
                    </button>
                  ))}
                  {resource.title === "Service catalog" && (
                    <a href={`/admin/catalog/services/${id}`}>Open tabs</a>
                  )}
                  {resource.title === "Staff profiles" && (
                    <a href={`/admin/staff/${id}`}>Assignments & skills</a>
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
        General
      </span>
      <span role="tab">Pricing ({rows.length})</span>
      <span role="tab">Skills</span>
      <span role="tab">Resources</span>
      <span role="tab">Add-ons</span>
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
        <p className="eyebrow">SERVICE CONFIGURATION</p>
        <h1>{service?.name?.["vi-VN"] ?? service?.code ?? "Service detail"}</h1>
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
            General
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
              {name}
            </button>
          ))}
        </div>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Loading {tab.toLowerCase()}…
          </div>
        )}
        {state === "forbidden" && <p role="alert">Permission denied.</p>}
        {state === "error" && (
          <p role="alert">
            Unable to load this tab. Retry by selecting it again.
          </p>
        )}
        {state === "empty" && <p>No {tab.toLowerCase()} configured yet.</p>}
        {state === "ready" && (
          <pre className="data-panel">{JSON.stringify(data, null, 2)}</pre>
        )}
        <a href="/admin/catalog/services">Back to services</a>
      </section>
    </main>
  );
}

function StaffDetailScreen({ id }: { id: string }) {
  const [staff, setStaff] = useState<any>();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  async function load() {
    const [profile, branchRows, skillRows] = await Promise.all([
      authorizedFetch(`/v1/staff/${id}`),
      authorizedFetch(`/v1/staff/${id}/branches`),
      authorizedFetch(`/v1/staff/${id}/skills`),
    ]);
    if (!profile.ok) {
      setMessage("Unable to load staff profile.");
      return;
    }
    setStaff((await profile.json()).data);
    setAssignments((await branchRows.json()).data ?? []);
    setSkills((await skillRows.json()).data ?? []);
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function assign() {
    const branchId = window.prompt("Branch ID");
    if (!branchId) return;
    const response = await authorizedFetch(`/v1/staff/${id}/branches`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        branchId,
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
    const skillId = window.prompt("Skill ID");
    if (!skillId) return;
    const response = await authorizedFetch(`/v1/staff/${id}/skills`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        skills: [{ skillId, proficiencyLevel: "STANDARD" }],
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
        <p className="eyebrow">STAFF PROFILE</p>
        <h1>{staff?.displayName ?? "Staff detail"}</h1>
        {message && <p role="status">{message}</p>}
        <div className="tabs">
          <span>General</span>
          <span>Branches ({assignments.length})</span>
          <span>Skills ({skills.length})</span>
          <span>Upcoming shifts</span>
          <span>Leave</span>
        </div>
        <div className="actions">
          <button onClick={() => void assign()}>Assign branch</button>
          <button onClick={() => void assignSkill()}>Assign skill</button>
        </div>
        <pre className="data-panel">
          {JSON.stringify({ staff, assignments, skills }, null, 2)}
        </pre>
        <a href="/admin/staff/list">Back to staff</a>
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
    <main className="shell">
      <WorkspaceNav />
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>{config.title}</h1>
        {state === "loading" && (
          <div role="status" className="skeleton">
            Loading securely…
          </div>
        )}
        {state === "forbidden" && (
          <div role="alert" className="state">
            <h2>Permission required</h2>
            <p>Permission denied: your role cannot access this area.</p>
          </div>
        )}
        {state === "error" && (
          <div role="alert" className="state">
            <p>{error}</p>
            <button onClick={() => void load()}>Retry</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <p>{config.empty}</p>
            <button onClick={() => void load()}>Refresh</button>
          </div>
        )}
        {state === "ready" && (
          <pre className="data-panel">{JSON.stringify(data, null, 2)}</pre>
        )}
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

function WorkspaceNav() {
  return (
    <nav className="topbar">
      <a href="/admin/dashboard">Nailsoft</a>
      <a href="/admin/catalog/categories">Categories</a>
      <a href="/admin/catalog/services">Services</a>
      <a href="/admin/catalog/skills">Skills</a>
      <a href="/admin/catalog/resources">Resources</a>
      <a href="/admin/staff/list">Staff</a>
      <a href="/admin/scheduling/shifts">Shifts</a>
      <a href="/admin/scheduling/leave-requests">Leave</a>
    </nav>
  );
}
function inferConfig(pathname: string) {
  if (pathname.includes("/branches/"))
    return {
      title: pathname.endsWith("/hours") ? "Business hours" : "Branch details",
      endpoint: "/v1/branches",
      empty: "Branch data is unavailable.",
    };
  if (pathname.includes("/team/users/"))
    return {
      title: pathname.endsWith("/sessions") ? "User sessions" : "User details",
      endpoint: "/v1/users",
      empty: "User data is unavailable.",
    };
  return { title: "Administration", empty: "No data is available." };
}
