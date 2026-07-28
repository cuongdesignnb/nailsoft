/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";

type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Config = { title: string; endpoint: string; kind: string };

const configs: Record<string, Config> = {
  "/admin/stored-value": {
    title: "Stored-value dashboard",
    endpoint: "/v1/stored-value/reports/liability",
    kind: "report",
  },
  "/admin/gift-cards/products": {
    title: "Gift-card products",
    endpoint: "/v1/gift-card-products",
    kind: "products",
  },
  "/admin/gift-cards/issuance": {
    title: "Gift-card issuance",
    endpoint: "/v1/gift-cards",
    kind: "cards",
  },
  "/admin/gift-cards": {
    title: "Gift cards",
    endpoint: "/v1/gift-cards",
    kind: "cards",
  },
  "/admin/customer-credit": {
    title: "Customer credit",
    endpoint: "/v1/customer-credit",
    kind: "credits",
  },
  "/admin/stored-value/adjustments": {
    title: "Stored-value adjustments",
    endpoint: "/v1/stored-value-adjustments",
    kind: "adjustments",
  },
  "/admin/stored-value/liability": {
    title: "Stored-value liability",
    endpoint: "/v1/stored-value/reports/liability",
    kind: "report",
  },
  "/admin/stored-value/reconciliation": {
    title: "Stored-value reconciliation",
    endpoint: "/v1/stored-value/reports/reconciliation",
    kind: "report",
  },
  "/admin/stored-value/exceptions": {
    title: "Reconciliation exceptions",
    endpoint: "/v1/stored-value/reports/exceptions",
    kind: "report",
  },
  "/admin/stored-value/legal-policies": {
    title: "Legal and expiration policies",
    endpoint: "/v1/stored-value/legal-policies",
    kind: "policies",
  },
};

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403)
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
      "Internet connection required. Stored-value writes are never queued offline.",
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

function useResource(endpoint: string) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const value = await api(endpoint);
      const rows = Array.isArray(value)
        ? value
        : (value?.rows ?? (value ? [value] : []));
      setData(rows);
      setState(rows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause.message);
      setState(cause.forbidden ? "forbidden" : "error");
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
      "gift_card.updated",
      "customer_credit.updated",
      "stored_value.wallet_invalidated",
      "stored_value.liability_invalidated",
      "stored_value.reconciliation_invalidated",
      "pos.order.updated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load]);
  return { state, data, error, load };
}

export default function Sprint10Screen({ pathname }: { pathname: string }) {
  const orderMatch = pathname.match(
    /^\/admin\/pos\/orders\/([^/]+)\/(?:stored-value|gift-card)$/,
  );
  if (orderMatch) return <OrderStoredValue orderId={orderMatch[1]!} />;
  const detailMatch = pathname.match(/^\/admin\/gift-cards\/([^/]+)$/);
  if (detailMatch && !["products", "issuance"].includes(detailMatch[1]!))
    return <GiftCardDetail id={detailMatch[1]!} />;
  const key =
    Object.keys(configs)
      .sort((a, b) => b.length - a.length)
      .find(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      ) ?? "/admin/stored-value";
  return <StoredValuePage config={configs[key]!} />;
}

function StoredValuePage({ config }: { config: Config }) {
  const resource = useResource(config.endpoint);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setNotice("");
    try {
      await command(path, body);
      setNotice(
        "Saved successfully. Authoritative balances have been refreshed.",
      );
      await resource.load();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Command failed safely.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        {Object.entries(configs).map(([href, item]) => (
          <a key={href} href={href}>
            {item.title}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 10 · STORED VALUE</p>
        <div className="title-row">
          <div>
            <h1>{config.title}</h1>
            <p className="hint">
              Append-only ledger · online commands · idempotency · dual control
            </p>
          </div>
          <span className="timezone">PostgreSQL authoritative</span>
        </div>
        <CreateForm kind={config.kind} run={run} busy={busy} />
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <States resource={resource} />
        {resource.state === "ready" && (
          <DataTable
            rows={resource.data}
            kind={config.kind}
            run={run}
            busy={busy}
          />
        )}
      </section>
    </main>
  );
}

function States({ resource }: { resource: ReturnType<typeof useResource> }) {
  if (resource.state === "ready") return null;
  if (resource.state === "loading")
    return (
      <div className="skeleton" role="status">
        Loading secure stored-value data…
      </div>
    );
  if (resource.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Permission denied</h2>
        <p>This role cannot view or mutate stored-value liabilities.</p>
      </div>
    );
  if (resource.state === "empty")
    return (
      <div className="state">
        <h2>No records</h2>
        <p>No matching stored-value records exist.</p>
        <button onClick={() => void resource.load()}>Refresh</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>Unable to load</h2>
      <p>{resource.error}</p>
      <button onClick={() => void resource.load()}>Retry</button>
    </div>
  );
}

function CreateForm({
  kind,
  run,
  busy,
}: {
  kind: string;
  run: (path: string, body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = useMemo<Array<[string, string]>>(() => {
    if (kind === "products")
      return [
        ["productCode", "Product code"],
        ["name", "Name"],
        ["minimum", "Minimum minor"],
        ["maximum", "Maximum minor"],
      ];
    if (kind === "adjustments")
      return [
        ["branchId", "Operational branch ID"],
        ["customerId", "Customer ID"],
        ["amount", "Amount minor"],
        ["note", "Business reason"],
      ];
    if (kind === "policies")
      return [
        ["jurisdiction", "Jurisdiction"],
        ["effectiveFrom", "Effective from (ISO)"],
      ];
    return [];
  }, [kind]);
  if (!fields.length) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === "products")
      await run("/v1/gift-card-products", {
        productCode: values.productCode,
        name: { "vi-VN": values.name, "en-US": values.name },
        amountMode: "OPEN",
        cardForm: "BOTH",
        currency: "VND",
        minimumAmountMinor: values.minimum,
        maximumAmountMinor: values.maximum,
        fixedDenominationsMinor: [],
        maximumBalanceMinor: values.maximum,
        reloadable: true,
        assignmentPolicy: "BEARER_OR_CUSTOMER",
        pinRequired: true,
        branchScope: {},
        eligibilityPolicy: {},
        refundPolicy: {},
        replacementPolicy: {},
        limitsPolicy: {},
      });
    if (kind === "adjustments")
      await run("/v1/stored-value-adjustments", {
        branchId: values.branchId,
        customerId: values.customerId,
        currency: "VND",
        adjustmentType: "SERVICE_RECOVERY_CREDIT",
        amountMinor: values.amount,
        reasonCode: "SERVICE_RECOVERY",
        note: values.note,
      });
    if (kind === "policies")
      await run("/v1/stored-value/legal-policies", {
        jurisdiction: values.jurisdiction,
        expirationMode: "NO_EXPIRATION",
        breakageMode: "NONE",
        effectiveFrom: values.effectiveFrom || new Date().toISOString(),
      });
  };
  return (
    <form className="filters" onSubmit={(event) => void submit(event)}>
      {fields.map(([name, label]) => (
        <label key={name}>
          {label}
          <input
            required
            value={values[name] ?? ""}
            onChange={(event) =>
              setValues((old) => ({ ...old, [name]: event.target.value }))
            }
          />
        </label>
      ))}
      <button disabled={busy}>{busy ? "Saving…" : "Create"}</button>
    </form>
  );
}

function DataTable({
  rows,
  kind,
  run,
  busy,
}: {
  rows: any[];
  kind: string;
  run: (path: string, body: unknown) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Status</th>
            <th>Currency / balance</th>
            <th>Version</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = row.id ?? row.accountId ?? `${kind}-${index}`;
            const balance =
              row.balance?.availableMinor ??
              row.availableMinor ??
              row.liabilityMinor ??
              row.amountMinor ??
              "—";
            return (
              <tr key={id}>
                <td>
                  {row.cardReference ??
                    row.productCode ??
                    row.customerName ??
                    row.jurisdiction ??
                    row.accountType ??
                    row.entryType ??
                    id}
                </td>
                <td>{row.status ?? row.legalReviewStatus ?? "CURRENT"}</td>
                <td>
                  {row.currency ?? "VND"} {balance}
                </td>
                <td>{row.version ?? row.policyVersion ?? "—"}</td>
                <td>
                  <div className="actions">
                    {kind === "products" && row.status === "DRAFT" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(`/v1/gift-card-products/${id}/activate`, {
                            version: row.version,
                          })
                        }
                      >
                        Activate
                      </button>
                    )}
                    {kind === "cards" && row.status === "ACTIVE" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(`/v1/gift-cards/${id}/suspend`, {
                            version: row.version,
                            reason: "ADMIN_REVIEW",
                          })
                        }
                      >
                        Suspend
                      </button>
                    )}
                    {kind === "cards" && row.status === "SUSPENDED" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(`/v1/gift-cards/${id}/reactivate`, {
                            version: row.version,
                            reason: "REVIEW_COMPLETE",
                          })
                        }
                      >
                        Reactivate
                      </button>
                    )}
                    {kind === "adjustments" && row.status === "PENDING" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              `/v1/stored-value-adjustments/${id}/approve`,
                              {
                                version: row.version,
                                reason: "DUAL_CONTROL_APPROVED",
                              },
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              `/v1/stored-value-adjustments/${id}/reject`,
                              {
                                version: row.version,
                                reason: "DUAL_CONTROL_REJECTED",
                              },
                            )
                          }
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {kind === "policies" && row.status === "DRAFT" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            `/v1/stored-value/legal-policies/${id}/approve`,
                            {
                              version: row.version,
                              reason: "LEGAL_REVIEW_COMPLETE",
                            },
                          )
                        }
                      >
                        Approve
                      </button>
                    )}
                    {kind === "cards" && (
                      <a href={`/admin/gift-cards/${id}`}>Open</a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GiftCardDetail({ id }: { id: string }) {
  const card = useResource(`/v1/gift-cards/${id}`);
  const ledger = useResource(`/v1/gift-cards/${id}/ledger`);
  return (
    <main className="shell ops-shell">
      <section className="card">
        <p className="eyebrow">GIFT CARD DETAIL</p>
        <h1>Masked card and append-only ledger</h1>
        <States resource={card} />
        {card.state === "ready" && (
          <pre>{JSON.stringify(card.data[0], null, 2)}</pre>
        )}
        <h2>Ledger history</h2>
        <States resource={ledger} />
        {ledger.state === "ready" && (
          <DataTable
            rows={ledger.data}
            kind="ledger"
            run={async () => undefined}
            busy={false}
          />
        )}
      </section>
    </main>
  );
}

function OrderStoredValue({ orderId }: { orderId: string }) {
  const eligibility = useResource(
    `/v1/pos-orders/${orderId}/stored-value/eligibility`,
  );
  const applications = useResource(`/v1/pos-orders/${orderId}/stored-value`);
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [amount, setAmount] = useState("");
  const [version, setVersion] = useState("1");
  const [notice, setNotice] = useState("");
  const apply = async () => {
    try {
      await command(`/v1/pos-orders/${orderId}/stored-value/gift-card`, {
        number,
        pin: pin || undefined,
        requestedMinor: amount,
        version: Number(version),
      });
      setNotice(
        "Stored value reserved online. It will be committed only when the order is paid.",
      );
      await Promise.all([eligibility.load(), applications.load()]);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Reservation failed safely.",
      );
    }
  };
  return (
    <main className="shell ops-shell">
      <section className="card">
        <p className="eyebrow">POS · STORED VALUE</p>
        <h1>Redeem without covering tip or gift-card funding</h1>
        <States resource={eligibility} />
        {eligibility.state === "ready" && (
          <pre>{JSON.stringify(eligibility.data[0], null, 2)}</pre>
        )}
        <div className="filters">
          <label>
            Card number
            <input value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label>
            PIN
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <label>
            Requested minor
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Balance version
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <button onClick={() => void apply()}>Reserve online</button>
        </div>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <h2>Applications</h2>
        <States resource={applications} />
        {applications.state === "ready" && (
          <DataTable
            rows={applications.data}
            kind="applications"
            run={async () => undefined}
            busy={false}
          />
        )}
      </section>
    </main>
  );
}
