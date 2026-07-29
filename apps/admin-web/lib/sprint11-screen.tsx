/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { activeSession, authorizedFetch } from "./auth";
import { io } from "socket.io-client";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
const routes: Record<
  string,
  { title: string; endpoint: string; create?: string; fields?: string[] }
> = {
  "/admin/communications/templates": {
    title: "Email templates",
    endpoint: "/v1/communications/templates",
    create: "/v1/communications/templates",
    fields: ["code", "category"],
  },
  "/admin/communications/rules": {
    title: "Communication rules",
    endpoint: "/v1/communications/rules",
    create: "/v1/communications/rules",
    fields: ["domainEvent", "purpose", "templateVersionId", "branchId"],
  },
  "/admin/communications/messages": {
    title: "Message delivery",
    endpoint: "/v1/communications/messages",
  },
  "/admin/communications/suppressions": {
    title: "Contact suppressions",
    endpoint: "/v1/communications/messages",
  },
  "/admin/marketing/segments": {
    title: "Customer segments",
    endpoint: "/v1/customer-segments",
    create: "/v1/customer-segments",
    fields: ["name", "branchId", "locale"],
  },
  "/admin/marketing/campaigns": {
    title: "Email campaigns",
    endpoint: "/v1/marketing-campaigns",
    create: "/v1/marketing-campaigns",
    fields: [
      "name",
      "segmentId",
      "templateVersionId",
      "campaignType",
      "branchId",
    ],
  },
  "/admin/reviews": { title: "Verified reviews", endpoint: "/v1/reviews" },
  "/admin/review-requests": {
    title: "Review requests",
    endpoint: "/v1/review-requests",
  },
  "/admin/service-recovery": {
    title: "Service recovery",
    endpoint: "/v1/service-recovery/cases",
    create: "/v1/service-recovery/cases",
    fields: [
      "branchId",
      "customerId",
      "source",
      "severity",
      "category",
      "summary",
    ],
  },
};
const nav = [
  "/admin/communications/templates",
  "/admin/communications/messages",
  "/admin/marketing/segments",
  "/admin/marketing/campaigns",
  "/admin/reviews",
  "/admin/service-recovery",
];

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if ([401, 403].includes(response.status))
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok)
    throw new Error(
      `${body.error?.code ?? "REQUEST_FAILED"}: ${body.error?.message ?? "Retry safely"}`,
    );
  return body.data;
}
async function command(path: string, body: unknown) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Engagement writes are not queued offline.",
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

export default function Sprint11Screen({ pathname }: { pathname: string }) {
  const detailCampaign = pathname.match(
    /^\/admin\/marketing\/campaigns\/([^/]+)$/,
  );
  if (detailCampaign)
    return (
      <Detail
        title="Campaign detail"
        endpoint={`/v1/marketing-campaigns/${detailCampaign[1]}`}
        actions={["submit", "approve", "schedule", "pause", "resume", "cancel"]}
      />
    );
  const detailReview = pathname.match(/^\/admin\/reviews\/([^/]+)$/);
  if (detailReview)
    return (
      <Detail
        title="Review detail"
        endpoint={`/v1/reviews/${detailReview[1]}`}
        actions={["publish", "hide", "flag", "respond"]}
      />
    );
  const detailRecovery = pathname.match(/^\/admin\/service-recovery\/([^/]+)$/);
  if (detailRecovery)
    return (
      <Detail
        title="Recovery case"
        endpoint={`/v1/service-recovery/cases/${detailRecovery[1]}`}
        actions={["triage", "start", "wait-customer", "resolve", "close"]}
      />
    );
  const customer = pathname.match(/^\/admin\/customers\/([^/]+)\/engagement$/);
  if (customer)
    return (
      <Detail
        title="Customer engagement timeline"
        endpoint={`/v1/customers/${customer[1]}/engagement-timeline`}
        actions={[]}
      />
    );
  const key =
    Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((x) => pathname === x || pathname.startsWith(`${x}/`)) ??
    "/admin/communications/messages";
  return <Workspace config={routes[key]!} />;
}

function useData(endpoint: string) {
  const [state, setState] = useState<State>("loading"),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
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
  useEffect(() => {
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, {
      auth: { token: session.accessToken },
      transports: ["websocket"],
    });
    [
      "communication.updated",
      "marketing.updated",
      "review.updated",
      "service_recovery.updated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load]);
  return { state, rows, error, load };
}
function States({ resource }: { resource: ReturnType<typeof useData> }) {
  if (resource.state === "ready") return null;
  if (resource.state === "loading")
    return (
      <div className="skeleton">Loading authoritative engagement data…</div>
    );
  if (resource.state === "forbidden")
    return (
      <div className="state">
        <h2>Permission denied</h2>
        <p>Your role or branch scope does not permit this workspace.</p>
      </div>
    );
  if (resource.state === "empty")
    return (
      <div className="state">
        <h2>No records</h2>
        <p>No matching records yet.</p>
        <button onClick={() => void resource.load()}>Refresh</button>
      </div>
    );
  return (
    <div className="state">
      <h2>Unable to load</h2>
      <p>{resource.error}</p>
      <button onClick={() => void resource.load()}>Retry</button>
    </div>
  );
}
function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        {nav.map((href) => (
          <a key={href} href={href}>
            {routes[href]?.title}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 11 · EMAIL ENGAGEMENT</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Consent ledger · send-time recheck · dual control · audited
              recovery
            </p>
          </div>
          <span className="timezone">Email only</span>
        </div>
        {children}
      </section>
    </main>
  );
}
function Workspace({ config }: { config: (typeof routes)[string] }) {
  const resource = useData(config.endpoint),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [values, setValues] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!config.create) return;
    setBusy(true);
    setNotice("");
    try {
      let body: any = { ...values };
      if (config.title.includes("segments"))
        body = {
          name: values.name,
          branchId: values.branchId || null,
          filters: {
            locale: values.locale || undefined,
            marketingConsent: true,
          },
        };
      if (config.title.includes("campaign"))
        body = {
          ...values,
          branchId: values.branchId || null,
          riskLevel: "STANDARD",
        };
      if (config.title.includes("recovery"))
        body = {
          ...values,
          source: values.source || "MANUAL",
          severity: values.severity || "MEDIUM",
        };
      await command(config.create, body);
      setNotice("Saved successfully.");
      setValues({});
      await resource.load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Command failed safely.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title={config.title}>
      {config.create && (
        <form className="form-grid" onSubmit={submit}>
          {config.fields?.map((field) => (
            <label key={field}>
              {field}
              <input
                required={!["branchId", "locale"].includes(field)}
                value={values[field] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [field]: e.target.value })
                }
              />
            </label>
          ))}
          <button disabled={busy}>{busy ? "Saving…" : "Create"}</button>
        </form>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <States resource={resource} />
      {resource.state === "ready" && <Table rows={resource.rows} />}
    </Shell>
  );
}
function Table({ rows }: { rows: any[] }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter(
      (x) =>
        ![
          "proposal_json",
          "filter_json",
          "variables_json",
          "rendered_html",
          "rendered_text",
        ].includes(x),
    )
    .slice(0, 8);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c}>
                  {typeof row[c] === "object"
                    ? JSON.stringify(row[c])
                    : String(row[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Detail({
  title,
  endpoint,
  actions,
}: {
  title: string;
  endpoint: string;
  actions: string[];
}) {
  const resource = useData(endpoint),
    [notice, setNotice] = useState("");
  const id = endpoint.split("/").at(-1);
  async function run(action: string) {
    try {
      const body: any = {
        version: resource.rows[0]?.version,
        reason: "Reviewed in Admin Web",
      };
      if (action === "schedule")
        body.scheduledAt = new Date(Date.now() + 60_000).toISOString();
      if (action === "respond")
        body.responseText = "Thank you for your feedback. We are following up.";
      await command(`${endpoint}/${action}`, body);
      setNotice(`${action} completed.`);
      await resource.load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Command failed");
    }
  }
  return (
    <Shell title={title}>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <States resource={resource} />
      {resource.state === "ready" && (
        <>
          <div className="actions">
            {actions.map((a) => (
              <button key={a} onClick={() => void run(a)}>
                {a}
              </button>
            ))}
          </div>
          <pre className="data-panel">
            {JSON.stringify(resource.rows[0], null, 2)}
          </pre>
          <small>Record {id}</small>
        </>
      )}
    </Shell>
  );
}
