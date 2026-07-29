/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "./auth";
type State = "loading" | "ready" | "empty" | "error" | "forbidden";
type Config = {
  title: string;
  endpoint: string;
  create?: string;
  actions?: string[];
  hint: string;
};
const configs: Record<string, Config> = {
  "/admin/time-clock": {
    title: "Live time clock",
    endpoint: "/v1/time-clock/sessions",
    hint: "Server-time attendance and active sessions",
  },
  "/admin/time-clock/sessions": {
    title: "Attendance sessions",
    endpoint: "/v1/time-clock/sessions",
    hint: "Scheduled versus actual, breaks and review state",
  },
  "/admin/time-clock/exceptions": {
    title: "Attendance exceptions",
    endpoint: "/v1/time-clock/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "Evidence-led missed punch and compliance review",
  },
  "/admin/time-clock/devices": {
    title: "Trusted clock devices",
    endpoint: "/v1/time-clock/devices",
    create: "/v1/time-clock/devices",
    actions: ["revoke"],
    hint: "Branch-bound kiosk and device trust",
  },
  "/admin/timesheets": {
    title: "Staff timesheets",
    endpoint: "/v1/timesheets",
    actions: ["submit", "approve", "reject", "reopen", "lock"],
    hint: "Review, correction, dual approval and source lock",
  },
  "/admin/timesheet-periods": {
    title: "Timesheet periods",
    endpoint: "/v1/timesheet-periods",
    create: "/v1/timesheet-periods",
    hint: "Submission and review windows",
  },
  "/admin/workforce/policies": {
    title: "Workforce policies",
    endpoint: "/v1/workforce-compliance/policies",
    create: "/v1/workforce-compliance/policies",
    hint: "Versioned configurable rules with legal-review gate",
  },
  "/admin/workforce/compliance": {
    title: "Workforce compliance",
    endpoint: "/v1/time-clock/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "No jurisdiction rule is hardcoded",
  },
  "/admin/workforce/reports": {
    title: "Workforce reports",
    endpoint: "/v1/workforce/reports/attendance",
    hint: "Attendance, overtime, break and exception evidence",
  },
  "/admin/payroll/calendars": {
    title: "Payroll calendars",
    endpoint: "/v1/payroll-calendars",
    create: "/v1/payroll-calendars",
    hint: "Timezone-aware configurable payroll frequency",
  },
  "/admin/payroll/periods": {
    title: "Payroll periods",
    endpoint: "/v1/payroll/periods",
    create: "/v1/payroll/periods/generate",
    hint: "Ready periods from locked timesheet windows",
  },
  "/admin/payroll/runs": {
    title: "Payroll runs",
    endpoint: "/v1/payroll/runs",
    create: "/v1/payroll/runs",
    actions: [
      "calculate",
      "recalculate",
      "submit",
      "approve",
      "finalize",
      "request-void",
      "approve-void",
    ],
    hint: "Deterministic sources, independent approval and immutable finalize",
  },
  "/admin/payroll/exceptions": {
    title: "Payroll exceptions",
    endpoint: "/v1/payroll/exceptions",
    actions: ["acknowledge", "resolve", "waive"],
    hint: "Blocking source, policy, currency and payout readiness issues",
  },
  "/admin/payroll/statements": {
    title: "Pay statements",
    endpoint: "/v1/pay-statements",
    hint: "Private immutable finalized statements",
  },
  "/admin/payroll/reports": {
    title: "Payroll reports",
    endpoint: "/v1/payroll/reports/summary",
    hint: "Earnings, commission, tips and source reconciliation",
  },
  "/admin/payouts": {
    title: "Payout batches",
    endpoint: "/v1/payout-batches",
    create: "/v1/payout-batches",
    actions: ["submit", "approve", "process", "cancel"],
    hint: "No PAID state without external or approved manual evidence",
  },
  "/admin/payout-reconciliation": {
    title: "Payout reconciliation",
    endpoint: "/v1/payout-reconciliations",
    hint: "Expected, confirmed, reversed and variance evidence",
  },
};
const nav = [
  "/admin/time-clock",
  "/admin/timesheets",
  "/admin/workforce/compliance",
  "/admin/payroll/runs",
  "/admin/payroll/statements",
  "/admin/payouts",
];
async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init),
    body = await response.json().catch(() => ({}));
  if ([401, 403].includes(response.status))
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok)
    throw new Error(
      `${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Retry safely"}`,
    );
  return body.data;
}
async function command(path: string, body: any) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Payroll and clock writes are not queued offline.",
    );
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
export default function Sprint12Screen({ pathname }: { pathname: string }) {
  const payProfile = pathname.match(/^\/admin\/staff\/([^/]+)\/pay-profile$/);
  const detail = pathname.match(
    /^\/admin\/(payroll\/runs|payouts|timesheets)\/([^/]+)$/,
  );
  if (payProfile) {
    return (
      <Workspace
        config={{
          title: "Staff pay profile",
          endpoint: `/v1/staff/${payProfile[1]}/pay-profile`,
          create: `/v1/staff/${payProfile[1]}/pay-profile/update`,
          hint: "Effective-dated pay configuration and payout readiness",
        }}
      />
    );
  }
  const normalized = detail
    ? `/admin/${detail[1]}`
    : (Object.keys(configs)
        .sort((a, b) => b.length - a.length)
        .find((x) => pathname === x || pathname.startsWith(`${x}/`)) ??
      "/admin/time-clock");
  const cfg = configs[normalized]!;
  return <Workspace config={cfg} detailId={detail?.[2]} />;
}
function Workspace({
  config,
  detailId,
}: {
  config: Config;
  detailId?: string | undefined;
}) {
  const endpoint = detailId
      ? `${config.endpoint}/${detailId}`
      : config.endpoint,
    [state, setState] = useState<State>("loading"),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [json, setJson] = useState("{}");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const raw = await api(endpoint),
        list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      setRows(list);
      setState(list.length ? "ready" : "empty");
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }, [endpoint]);
  useEffect(() => void load(), [load]);
  const columns = useMemo(
    () =>
      Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
        .filter(
          (key) =>
            ![
              "policyJson",
              "statementJson",
              "snapshotJson",
              "locationEvidenceJson",
            ].includes(key),
        )
        .slice(0, 8),
    [rows],
  );
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await command(config.create!, JSON.parse(json));
      setNotice("Saved. Authoritative data was refreshed.");
      await load();
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }
  async function act(row: any, action: string) {
    try {
      await command(`${config.endpoint}/${row.id}/${action}`, {
        version: row.version,
        reason: "Reviewed in Sprint 12 operations workspace",
      });
      setNotice(`${action} completed.`);
      await load();
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
    }
  }
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        {nav.map((href) => (
          <a key={href} href={href}>
            {configs[href]?.title}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 12 · WORKFORCE & PAYROLL</p>
        <div className="title-row">
          <div>
            <h1>{config.title}</h1>
            <p className="hint">{config.hint}</p>
          </div>
          <span className="timezone">Online writes · UTC ledger</span>
        </div>
        {notice && <p className="success">{notice}</p>}
        {state === "loading" && (
          <div className="skeleton">Loading authoritative workforce data…</div>
        )}
        {state === "forbidden" && (
          <div className="state">
            <h2>Permission denied</h2>
            <p>
              Your role, tenant or branch scope does not permit this workspace.
            </p>
          </div>
        )}
        {state === "error" && (
          <div className="state">
            <h2>Unable to load</h2>
            <p>{error}</p>
            <button onClick={() => void load()}>Retry</button>
          </div>
        )}
        {state === "empty" && (
          <div className="state">
            <h2>No records</h2>
            <p>No matching records yet. This is an operational empty state.</p>
            <button onClick={() => void load()}>Refresh</button>
          </div>
        )}
        {state === "ready" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  {config.actions && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c}>
                        {typeof row[c] === "object"
                          ? JSON.stringify(row[c])
                          : String(row[c] ?? "—")}
                      </td>
                    ))}
                    {config.actions && (
                      <td className="actions">
                        {config.actions.map((a) => (
                          <button key={a} onClick={() => void act(row, a)}>
                            {a}
                          </button>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {config.create && (
          <form onSubmit={create} className="form-grid">
            <label className="full">
              Command payload (validated by API)
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={7}
              />
            </label>
            <button type="submit">Create</button>
          </form>
        )}
        <p className="hint">
          Realtime messages are refetch signals; PostgreSQL remains
          authoritative. Sensitive bank, device, location and statement payloads
          are not rendered in list views.
        </p>
      </section>
    </main>
  );
}
