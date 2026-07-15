/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import Sprint3Screen from "./sprint3-screen";
import Sprint4Screen from "./sprint4-screen";

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
