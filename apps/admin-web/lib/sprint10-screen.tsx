/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";
import { legacyColumnLabel, legacyText, legacyValue } from "./legacy-workspace-ui";

type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";
type Config = { title: string; endpoint: string; kind: string };

const configs: Record<string, Config> = {
  "/admin/stored-value": {
    title: "Trung tâm Stored Value",
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
  if (pathname === "/admin/stored-value" || pathname === "/admin/stored-value/")
    return <StoredValueOverview />;
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

type StoredValueReport = {
  kind?: string;
  rows: any[];
  mismatches?: any[];
  generatedAt?: string;
};

function useStoredValueReport(kind: string) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<StoredValueReport>({ rows: [] });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const value = await api(`/v1/stored-value/reports/${kind}`);
      const rows = Array.isArray(value) ? value : value?.rows ?? [];
      setData({
        ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
        rows,
      });
      setState(rows.length ? "ready" : "empty");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải báo cáo Stored Value.");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  }, [kind]);
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
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load]);
  return { state, data, error, load };
}

function storedValueMoney(value: any, currency = "VND") {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(numeric / (currency === "VND" ? 1 : 100));
}

function storedValueByCurrency(rows: any[], field: string) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = String(row.currency ?? "VND");
    totals.set(currency, (totals.get(currency) ?? 0) + Number(row[field] ?? 0));
  }
  return [...totals.entries()]
    .map(([currency, amount]) => storedValueMoney(amount, currency))
    .join(" · ") || "—";
}

function storedValueAccountType(value: any) {
  return ({
    CUSTOMER_CREDIT: "Store Credit",
    GIFT_CARD: "Gift Card",
    PREPAID: "Giá trị trả trước",
  } as Record<string, string>)[String(value ?? "").toUpperCase()] ?? legacyText(String(value ?? "Tài khoản Stored Value"));
}

function storedValueReportState(resource: ReturnType<typeof useStoredValueReport>, label: string) {
  if (resource.state === "loading") return <div className="sv-state" role="status">Đang tải {label}…</div>;
  if (resource.state === "forbidden") return <div className="sv-state sv-state-danger" role="alert">Bạn không có quyền xem {label}.</div>;
  if (resource.state === "error") return <div className="sv-state sv-state-danger" role="alert"><strong>Không thể tải {label}.</strong><span>{resource.error}</span><button className="sv-button sv-button-secondary" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "empty") return <div className="sv-state" role="status">Chưa có dữ liệu {label} trong phạm vi hiện tại.</div>;
  return null;
}

function StoredValueOverview() {
  const liability = useStoredValueReport("liability");
  const customerCredit = useStoredValueReport("customer-credit");
  const reconciliation = useStoredValueReport("reconciliation");
  const rows = liability.data.rows;
  const customerCreditRows = customerCredit.data.rows;
  const generatedAt = liability.data.generatedAt ?? reconciliation.data.generatedAt;
  return (
    <main className="sv-overview">
      <header className="sv-header">
        <div>
          <p className="sv-eyebrow">NAILSOFT · STORED VALUE</p>
          <h1>Trung tâm Stored Value</h1>
          <p>Theo dõi nghĩa vụ Gift Card và Store Credit theo tiền tệ, số dư và đối soát từ dữ liệu máy chủ.</p>
        </div>
        <div className="sv-header-actions">
          <a className="sv-button sv-button-secondary" href="/admin/stored-value/reconciliation">Mở đối soát</a>
          <a className="sv-button sv-button-primary" href="/admin/stored-value/liability">Xem nghĩa vụ</a>
        </div>
      </header>
      {generatedAt ? <p className="sv-freshness">Dữ liệu cập nhật lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(generatedAt))}</p> : null}
      <section className="sv-kpis" aria-label="Tóm tắt Stored Value">
        <article><span>Nhóm tài khoản</span><strong>{liability.state === "ready" ? rows.length : "—"}</strong><small>Theo tiền tệ và loại tài khoản</small></article>
        <article className="is-emphasis"><span>Số dư khả dụng</span><strong>{liability.state === "ready" ? storedValueByCurrency(rows, "availableMinor") : "—"}</strong><small>Giá trị có thể sử dụng tiếp</small></article>
        <article><span>Đang giữ tại POS</span><strong>{liability.state === "ready" ? storedValueByCurrency(rows, "reservedMinor") : "—"}</strong><small>Không đồng nghĩa đã sử dụng</small></article>
        <article><span>Tổng nghĩa vụ</span><strong>{liability.state === "ready" ? storedValueByCurrency(rows, "liabilityMinor") : "—"}</strong><small>Khả dụng cộng đang giữ</small></article>
        <article><span>Store Credit</span><strong>{customerCredit.state === "ready" ? storedValueByCurrency(customerCreditRows, "liabilityMinor") : "—"}</strong><small>Nhóm Customer Credit</small></article>
        <article><span>Điểm cần đối soát</span><strong>{reconciliation.state === "ready" ? reconciliation.data.mismatches?.length ?? 0 : "—"}</strong><small>So sánh Account và Ledger</small></article>
      </section>
      <section className="sv-overview-grid">
        <section className="sv-panel">
          <div className="sv-panel-heading"><div><p className="sv-eyebrow">ACCOUNT PROJECTION</p><h2>Nghĩa vụ theo domain</h2></div><span className="sv-source-badge">API báo cáo</span></div>
          {storedValueReportState(liability, "nghĩa vụ Stored Value")}
          {liability.state === "ready" ? <div className="sv-table-wrap"><table><caption className="sr-only">Nghĩa vụ Stored Value theo loại tài khoản và tiền tệ</caption><thead><tr><th scope="col">Domain</th><th scope="col">Tiền tệ</th><th scope="col">Khả dụng</th><th scope="col">Đang giữ</th><th scope="col">Tổng nghĩa vụ</th><th scope="col">Mở</th></tr></thead><tbody>{rows.map((row: any) => <tr key={`${row.accountType}-${row.currency}`}><td><strong>{storedValueAccountType(row.accountType)}</strong><small>{row.accountType ?? "—"}</small></td><td>{row.currency ?? "—"}</td><td>{storedValueMoney(row.availableMinor, row.currency)}</td><td>{storedValueMoney(row.reservedMinor, row.currency)}</td><td><strong>{storedValueMoney(row.liabilityMinor, row.currency)}</strong></td><td>{row.accountType === "CUSTOMER_CREDIT" ? <a href="/admin/customer-credit">Store Credit</a> : row.accountType === "GIFT_CARD" ? <a href="/admin/gift-cards">Gift Card</a> : <a href="/admin/stored-value/liability">Chi tiết</a>}</td></tr>)}</tbody></table></div> : null}
        </section>
        <aside className="sv-side-stack">
          <section className="sv-panel sv-panel-soft"><p className="sv-eyebrow">THEO DÕI DOMAIN</p><h2>Điểm vào vận hành</h2><div className="sv-link-list"><a href="/admin/customer-credit"><span><strong>Store Credit</strong><small>Account theo Customer + tiền tệ</small></span><b>→</b></a><a href="/admin/gift-cards"><span><strong>Gift Card</strong><small>Thẻ, số dư và vòng đời</small></span><b>→</b></a><a href="/admin/stored-value/adjustments"><span><strong>Điều chỉnh có kiểm soát</strong><small>Yêu cầu và phê duyệt kép</small></span><b>→</b></a><a href="/admin/stored-value/legal-policies"><span><strong>Chính sách pháp lý</strong><small>Hiệu lực theo nguồn máy chủ</small></span><b>→</b></a></div></section>
          <section className="sv-panel"><p className="sv-eyebrow">RECONCILIATION</p><h2>Đối soát tài khoản</h2>{storedValueReportState(reconciliation, "đối soát")}{reconciliation.state === "ready" ? <><div className={`sv-reconcile ${reconciliation.data.mismatches?.length ? "is-danger" : "is-good"}`}><strong>{reconciliation.data.mismatches?.length ? `${reconciliation.data.mismatches.length} điểm lệch cần kiểm tra` : "Account và Ledger đang khớp"}</strong><span>So sánh projection với tổng delta của Ledger.</span></div><a className="sv-text-link" href="/admin/stored-value/reconciliation">Xem báo cáo đối soát →</a></> : null}</section>
        </aside>
      </section>
      <section className="sv-notice"><strong>Sổ Stored Value chỉ ghi thêm</strong><span>Số dư được cập nhật qua workflow của domain và Ledger bất biến. Màn hình này không cho sửa trực tiếp Account hoặc tạo giao dịch ngoài quy trình.</span></section>
    </main>
  );
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
            {legacyText(item.title)}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">NAILSOFT · STORED VALUE</p>
        <div className="title-row">
          <div>
            <h1>{legacyText(config.title)}</h1>
            <p className="hint">
              Sổ append-only · lệnh online · idempotency · kiểm soát kép
            </p>
          </div>
          <span className="timezone">PostgreSQL là nguồn chính thức</span>
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
        Đang tải dữ liệu Stored Value an toàn…
      </div>
    );
  if (resource.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Không có quyền truy cập</h2>
        <p>Vai trò hiện tại không được phép xem hoặc thay đổi nghĩa vụ Stored Value.</p>
      </div>
    );
  if (resource.state === "empty")
    return (
      <div className="state">
        <h2>Chưa có dữ liệu</h2>
        <p>Chưa có bản ghi Stored Value phù hợp.</p>
        <button onClick={() => void resource.load()}>Làm mới</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>Không thể tải dữ liệu</h2>
      <p>{resource.error}</p>
      <button onClick={() => void resource.load()}>Thử lại</button>
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
            <th scope="col">Tham chiếu</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Tiền tệ / số dư</th>
            <th scope="col">Phiên bản</th>
            <th scope="col">Thao tác</th>
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
                <td data-label="Tham chiếu">
                  {row.cardReference ??
                    row.productCode ??
                    row.customerName ??
                    row.jurisdiction ??
                    row.accountType ??
                    row.entryType ??
                    "Mã hệ thống"}
                </td>
                <td data-label="Trạng thái">{legacyValue(row.status ?? row.legalReviewStatus ?? "CURRENT", "status")}</td>
                <td data-label="Tiền tệ / số dư">
                  {row.currency ?? "VND"} {legacyValue(balance, "amountMinor")}
                </td>
                <td data-label="Phiên bản">{row.version ?? row.policyVersion ?? "—"}</td>
                <td data-label="Thao tác">
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
                        Kích hoạt
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
                        Tạm khóa
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
                        Kích hoạt lại
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
                          Phê duyệt
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
                          Từ chối
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
                        Phê duyệt
                      </button>
                    )}
                    {kind === "cards" && (
                      <a href={`/admin/gift-cards/${id}`}>Mở chi tiết</a>
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

function SafeFacts({ value }: { value: any }) {
  const source = value && typeof value === "object" ? value : {};
  const entries = Object.entries(source).filter(([key]) => !/(number|pin|secret|token|hash|json)/i.test(key)).slice(0, 12);
  return <div className="legacy-data-grid">{entries.map(([key, item]) => <div className="legacy-data-item" key={key}><span>{legacyColumnLabel(key)}</span><strong>{legacyValue(item, key)}</strong></div>)}</div>;
}

function GiftCardDetail({ id }: { id: string }) {
  const card = useResource(`/v1/gift-cards/${id}`);
  const ledger = useResource(`/v1/gift-cards/${id}/ledger`);
  return (
    <main className="shell ops-shell">
      <section className="card">
        <p className="eyebrow">NAILSOFT · GIFT CARD</p>
        <h1>Thẻ đã che số và sổ append-only</h1>
        <States resource={card} />
        {card.state === "ready" && (
          <SafeFacts value={card.data[0]} />
        )}
        <h2>Lịch sử sổ</h2>
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
        <h1>Kiểm tra và giữ Stored Value theo đơn POS</h1>
        <States resource={eligibility} />
        {eligibility.state === "ready" && (
          <SafeFacts value={eligibility.data[0]} />
        )}
        <div className="filters">
          <label>
            Số Gift Card
            <input type="password" autoComplete="off" value={number} onChange={(e) => setNumber(e.target.value)} />
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
            Số tiền yêu cầu (minor)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Phiên bản số dư
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <button onClick={() => void apply()}>Giữ số dư online</button>
        </div>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <h2>Ứng dụng Stored Value</h2>
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
