/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";

type ViewState = "loading" | "ready" | "empty" | "error" | "forbidden";
async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init),
    body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403)
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok)
    throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
      code: body.error?.code,
    });
  return body.data;
}
async function command(path: string, body: unknown) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Financial commands are not queued offline.",
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
function useData(path: string | null) {
  const [state, setState] = useState<ViewState>("loading"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    setState("loading");
    try {
      const value = await api(path);
      setData(value);
      const empty = Array.isArray(value)
        ? !value.length
        : Array.isArray(value?.rows)
          ? !value.rows.length
          : false;
      setState(empty ? "empty" : "ready");
    } catch (reason: any) {
      setError(reason.message);
      setState(reason.forbidden ? "forbidden" : "error");
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, {
      auth: { token: session.accessToken },
      transports: ["websocket"],
    });
    [
      "refund.updated",
      "credit_note.updated",
      "commission.updated",
      "financial.updated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load]);
  return { state, data, error, load, setData };
}
function States({
  value,
  label,
}: {
  value: ReturnType<typeof useData>;
  label: string;
}) {
  if (value.state === "ready") return null;
  if (value.state === "loading")
    return (
      <div className="skeleton" role="status">
        Loading {label}…
      </div>
    );
  if (value.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Permission denied</h2>
        <p>Your role or branch scope does not allow this financial view.</p>
      </div>
    );
  if (value.state === "empty")
    return (
      <div className="state">
        <h2>No {label}</h2>
        <p>No records match the current scope.</p>
        <button onClick={() => void value.load()}>Refresh</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>Unable to load</h2>
      <p>{value.error}</p>
      <button onClick={() => void value.load()}>Retry</button>
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
        <a href="/admin/refunds">Refunds</a>
        <a href="/admin/credit-notes">Credit notes</a>
        <a href="/admin/commission/rules">Rules</a>
        <a href="/admin/commission/entries">Entries</a>
        <a href="/admin/commission/periods">Periods</a>
        <a href="/admin/commission/adjustments">Adjustments</a>
        <a href="/admin/financial/refunds">Reports</a>
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 7 · FINANCIAL CORRECTIONS</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Original invoices and captured payments remain immutable.
              PostgreSQL evidence is authoritative.
            </p>
          </div>
          <span className="timezone">Online only</span>
        </div>
        {children}
      </section>
    </main>
  );
}
const money = (value: number, currency = "VND") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format((value ?? 0) / (currency === "VND" ? 1 : 100));
const rows = (data: any) =>
  Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
const label = (item: any) =>
  item.refundReference ??
  item.creditNoteNumber ??
  item.ruleCode ??
  item.code ??
  item.display_name ??
  item.staffName ??
  item.exportType ??
  item.id;

export default function Sprint7Screen({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean),
    id = parts[2] ?? "";
  if (pathname === "/admin/refunds/new") return <RefundWizard />;
  if (pathname.startsWith("/admin/refunds/") && id)
    return <RefundDetail id={id} mode={parts[3]} />;
  if (pathname === "/admin/refunds")
    return (
      <Resource
        title="Refund ledger"
        path="/v1/refunds"
        create="/admin/refunds/new"
      />
    );
  if (pathname.startsWith("/admin/credit-notes/") && id)
    return <CreditNote id={id} />;
  if (pathname === "/admin/credit-notes")
    return <Resource title="Credit notes" path="/v1/credit-notes" />;
  if (pathname === "/admin/commission/rules/new") return <RuleEditor />;
  if (pathname.startsWith("/admin/commission/rules/") && parts[3])
    return (
      <Resource
        title="Commission rule"
        path={`/v1/commission-rules/${parts[3]}`}
      />
    );
  if (pathname === "/admin/commission/rules")
    return (
      <Resource
        title="Commission rules"
        path="/v1/commission-rules"
        create="/admin/commission/rules/new"
      />
    );
  if (pathname === "/admin/commission/entries")
    return (
      <Resource title="Commission entries" path="/v1/commission-entries" />
    );
  if (pathname.startsWith("/admin/commission/periods/") && parts[3])
    return <Period id={parts[3]} />;
  if (pathname === "/admin/commission/periods") return <Periods />;
  if (pathname === "/admin/commission/adjustments") return <Adjustments />;
  return <Reports pathname={pathname} />;
}

function Resource({
  title,
  path,
  create,
}: {
  title: string;
  path: string;
  create?: string;
}) {
  const value = useData(path);
  return (
    <Shell title={title}>
      {create && (
        <p>
          <a className="button" href={create}>
            Create
          </a>
        </p>
      )}
      <States value={value} label={title.toLowerCase()} />
      {value.state === "ready" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Currency</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows(value.data).map((item: any) => (
                <tr key={item.id}>
                  <td>{label(item)}</td>
                  <td>
                    <span className="pill">
                      {item.status ?? item.entryType}
                    </span>
                  </td>
                  <td>
                    {item.requestedMinor !== undefined
                      ? money(item.requestedMinor, item.currency)
                      : item.commissionMinor !== undefined
                        ? money(item.commissionMinor, item.currency)
                        : item.totalMinor !== undefined
                          ? money(item.totalMinor, item.currency)
                          : "—"}
                  </td>
                  <td>{item.currency ?? "—"}</td>
                  <td>
                    {item.refundReference ? (
                      <a href={`/admin/refunds/${item.id}`}>Open</a>
                    ) : item.creditNoteNumber ? (
                      <a href={`/admin/credit-notes/${item.id}`}>Open</a>
                    ) : item.ruleCode ? (
                      <a href={`/admin/commission/rules/${item.id}`}>Open</a>
                    ) : (
                      "Immutable"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function RefundWizard() {
  const [invoiceId, setInvoiceId] = useState(""),
    [lineId, setLineId] = useState(""),
    [amount, setAmount] = useState(""),
    [tip, setTip] = useState("0"),
    [reason, setReason] = useState("CUSTOMER_REQUEST"),
    [preview, setPreview] = useState<any>(),
    [message, setMessage] = useState("");
  const payload = {
    items: [{ invoiceLineId: lineId, amountMinor: Number(amount) }],
    tipAmountMinor: Number(tip),
  };
  async function plan(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    try {
      setPreview(
        await command(`/v1/invoices/${invoiceId}/refund-plans`, payload),
      );
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  async function create() {
    try {
      const result = await command(`/v1/invoices/${invoiceId}/refunds`, {
        ...payload,
        reasonCode: reason,
        reasonText: "Requested through refund wizard",
      });
      location.href = `/admin/refunds/${result.id}`;
    } catch (x: any) {
      setMessage(
        x.code === "REFUND_VERSION_CONFLICT"
          ? "Version conflict. Refresh and preview again."
          : x.message,
      );
    }
  }
  return (
    <Shell title="Request a refund">
      <form className="form-grid" onSubmit={plan}>
        <label>
          Invoice ID
          <input
            required
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          />
        </label>
        <label>
          Invoice line ID
          <input
            required
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
          />
        </label>
        <label>
          Line refund (minor units)
          <input
            required
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Tip refund (minor units)
          <input
            type="number"
            min="0"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
          />
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>CUSTOMER_REQUEST</option>
            <option>SERVICE_QUALITY</option>
            <option>DUPLICATE_CHARGE</option>
          </select>
        </label>
        <button type="submit">Preview authoritative totals</button>
      </form>
      {message && <p role="alert">{message}</p>}
      {preview && (
        <section className="state">
          <h2>Approval preview</h2>
          <p>
            {money(preview.requestedMinor, preview.currency)} ·{" "}
            {preview.approval.required
              ? "Approval required"
              : "Direct execution allowed"}
          </p>
          <p>
            Original tender allocation:{" "}
            {preview.paymentAllocations
              .map(
                (x: any) =>
                  `${x.tenderType} ${money(x.plannedMinor, preview.currency)}`,
              )
              .join(", ")}
          </p>
          <button onClick={() => void create()}>Create draft</button>
        </section>
      )}
    </Shell>
  );
}

function RefundDetail({ id, mode }: { id: string; mode?: string | undefined }) {
  const value = useData(`/v1/refunds/${id}`),
    [message, setMessage] = useState("");
  async function act(action: string, extra: any = {}) {
    const current = value.data;
    if (!current) return;
    try {
      await command(`/v1/refunds/${id}/${action}`, {
        version: current.version,
        ...extra,
      });
      setMessage(`${action} completed.`);
      await value.load();
    } catch (x: any) {
      setMessage(
        x.code === "REFUND_VERSION_CONFLICT"
          ? "Version conflict. Data was refreshed."
          : x.message,
      );
      await value.load();
    }
  }
  return (
    <Shell
      title={
        mode === "approval"
          ? "Refund approval"
          : mode === "execute"
            ? "Refund execution"
            : "Refund detail"
      }
    >
      <States value={value} label="refund" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <div className="money-grid">
            <article>
              <small>Requested</small>
              <strong>
                {money(value.data.requestedMinor, value.data.currency)}
              </strong>
            </article>
            <article>
              <small>Completed</small>
              <strong>
                {money(value.data.completedMinor, value.data.currency)}
              </strong>
            </article>
            <article>
              <small>Status</small>
              <strong>{value.data.status}</strong>
            </article>
          </div>
          <p>
            Invoice: {value.data.invoiceId} · Reason: {value.data.reasonCode}
          </p>
          <div className="actions">
            <button onClick={() => void act("submit")}>Submit</button>
            <button
              onClick={() =>
                void act("approve", {
                  reason: "Approved after evidence review",
                })
              }
            >
              Approve
            </button>
            <button
              onClick={() =>
                void act("reject", { reason: "Evidence is insufficient" })
              }
            >
              Reject
            </button>
            <button
              onClick={() =>
                void act("cancel", { reason: "Request cancelled" })
              }
            >
              Cancel
            </button>
          </div>
          <details>
            <summary>Immutable item and tender evidence</summary>
            <pre className="data-panel">
              {JSON.stringify(
                {
                  items: value.data.items,
                  paymentAllocations: value.data.paymentAllocations,
                  creditNote: value.data.creditNote,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </Shell>
  );
}

function CreditNote({ id }: { id: string }) {
  const value = useData(`/v1/credit-notes/${id}`),
    [message, setMessage] = useState("");
  async function deliver(channel: "PRINT" | "EMAIL") {
    try {
      await command(`/v1/credit-notes/${id}/deliver`, { channel });
      setMessage(`${channel} delivery requested.`);
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Immutable credit note">
      <States value={value} label="credit note" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <h2>{value.data.creditNoteNumber}</h2>
          <p>
            Original invoice: {value.data.originalInvoiceId} · Refund:{" "}
            {value.data.refundId}
          </p>
          <strong>{money(value.data.totalMinor, value.data.currency)}</strong>
          <div className="actions">
            <button onClick={() => void deliver("PRINT")}>Print</button>
            <button onClick={() => void deliver("EMAIL")}>Deliver</button>
          </div>
          <pre className="data-panel">
            {JSON.stringify(value.data.lines, null, 2)}
          </pre>
        </>
      )}
    </Shell>
  );
}

function RuleEditor() {
  const [form, setForm] = useState({
      ruleCode: "",
      ruleType: "SERVICE_PERCENT",
      baseMode: "NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX",
      percentBasisPoints: "1000",
      priority: "0",
      effectiveFrom: new Date().toISOString(),
    }),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await command("/v1/commission-rules", {
        ...form,
        percentBasisPoints: Number(form.percentBasisPoints),
        priority: Number(form.priority),
        policy: {},
      });
      location.href = `/admin/commission/rules/${result.id}`;
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="New commission rule">
      <form className="form-grid" onSubmit={submit}>
        <label>
          Rule code
          <input
            required
            value={form.ruleCode}
            onChange={(e) => setForm({ ...form, ruleCode: e.target.value })}
          />
        </label>
        <label>
          Rule type
          <select
            value={form.ruleType}
            onChange={(e) => setForm({ ...form, ruleType: e.target.value })}
          >
            <option>SERVICE_PERCENT</option>
            <option>SERVICE_FIXED</option>
          </select>
        </label>
        <label>
          Base mode
          <select
            value={form.baseMode}
            onChange={(e) => setForm({ ...form, baseMode: e.target.value })}
          >
            <option>NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX</option>
            <option>GROSS_SERVICE_BEFORE_DISCOUNT</option>
            <option>FIXED_PER_COMPLETED_SERVICE</option>
          </select>
        </label>
        <label>
          Basis points
          <input
            type="number"
            value={form.percentBasisPoints}
            onChange={(e) =>
              setForm({ ...form, percentBasisPoints: e.target.value })
            }
          />
        </label>
        <label>
          Priority
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </label>
        <button type="submit">Create immutable version</button>
      </form>
      {message && <p role="alert">{message}</p>}
    </Shell>
  );
}

function Periods() {
  const value = useData("/v1/commission-periods"),
    [code, setCode] = useState(""),
    [message, setMessage] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await command("/v1/commission-periods", {
        code,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 13 * 86400000)
          .toISOString()
          .slice(0, 10),
        currency: "VND",
      });
      setCode("");
      await value.load();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Commission periods">
      <form className="form-grid" onSubmit={create}>
        <label>
          Period code
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button>Create 14-day period</button>
      </form>
      {message && <p role="alert">{message}</p>}
      <States value={value} label="commission periods" />
      {value.state === "ready" &&
        rows(value.data).map((p: any) => (
          <article className="state" key={p.id}>
            <a href={`/admin/commission/periods/${p.id}`}>{p.code}</a> ·{" "}
            {p.status} · {p.startDate}–{p.endDate}
          </article>
        ))}
    </Shell>
  );
}
function Period({ id }: { id: string }) {
  const value = useData(`/v1/commission-periods/${id}`),
    [message, setMessage] = useState("");
  async function act(action: string) {
    try {
      await command(`/v1/commission-periods/${id}/${action}`, {
        version: value.data.version,
        reason: "Reviewed in Admin Web",
      });
      await value.load();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Commission period">
      <States value={value} label="period" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <h2>
            {value.data.code} · {value.data.status}
          </h2>
          <div className="actions">
            <button onClick={() => void act("start-review")}>
              Start review
            </button>
            <button onClick={() => void act("reopen-review")}>
              Return to open
            </button>
            <button onClick={() => void act("lock")}>Lock evidence</button>
          </div>
          <pre className="data-panel">
            {JSON.stringify(
              {
                totals: value.data.totals,
                statements: value.data.statements,
                integrityHash: value.data.integrityHash,
              },
              null,
              2,
            )}
          </pre>
        </>
      )}
    </Shell>
  );
}
function Adjustments() {
  const value = useData("/v1/commission-adjustments"),
    [message, setMessage] = useState("");
  return (
    <Shell title="Commission adjustments">
      <States value={value} label="adjustments" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" &&
        rows(value.data).map((a: any) => (
          <article className="state" key={a.id}>
            <strong>
              {money(a.amountMinor, a.currency)} · {a.status}
            </strong>
            <p>
              {a.reasonCode}: {a.note}
            </p>
            {a.status === "PENDING" && (
              <div className="actions">
                <button
                  onClick={async () => {
                    try {
                      await command(
                        `/v1/commission-adjustments/${a.id}/approve`,
                        { version: a.version, reason: "Evidence approved" },
                      );
                      await value.load();
                    } catch (x: any) {
                      setMessage(x.message);
                    }
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={async () => {
                    try {
                      await command(
                        `/v1/commission-adjustments/${a.id}/reject`,
                        { version: a.version, reason: "Evidence rejected" },
                      );
                      await value.load();
                    } catch (x: any) {
                      setMessage(x.message);
                    }
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
    </Shell>
  );
}

function Reports({ pathname }: { pathname: string }) {
  const segment = pathname.split("/").filter(Boolean)[2] ?? "refunds",
    endpoint = segment === "commission" ? "commission-liability" : segment,
    path = `/v1/financial/${endpoint}`,
    value = useData(path),
    [message, setMessage] = useState("");
  const title = useMemo(() => segment.replaceAll("-", " "), [segment]);
  async function exportReport() {
    try {
      await command("/v1/financial/exports", {
        exportType:
          segment === "commission"
            ? "COMMISSION_ENTRIES"
            : segment === "net-sales"
              ? "NET_SALES"
              : "REFUNDS",
        filters: {},
      });
      setMessage("Export requested. The signed download will expire.");
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title={`Financial ${title}`}>
      <div className="actions">
        <a href="/admin/financial/refunds">Refunds</a>
        <a href="/admin/financial/net-sales">Net sales</a>
        <a href="/admin/financial/commission">Commission</a>
        <button onClick={() => void exportReport()}>Export CSV</button>
      </div>
      {message && <p role="alert">{message}</p>}
      <States value={value} label={title} />
      {value.state === "ready" && (
        <pre className="data-panel">{JSON.stringify(value.data, null, 2)}</pre>
      )}
    </Shell>
  );
}
