/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
async function api(path: string, init?: RequestInit) {
  const result = await authorizedFetch(path, init),
    body = await result.json().catch(() => ({}));
  if (result.status === 401 || result.status === 403)
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!result.ok)
    throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
      code: body.error?.code,
    });
  return body.data;
}
async function command(path: string, body: unknown) {
  if (!navigator.onLine) throw new Error("Internet connection required");
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
function useData(path: string | null, realtime = true) {
  const [state, setState] = useState<State>("loading"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    setState("loading");
    try {
      const value = await api(path);
      setData(value);
      setState(Array.isArray(value) && !value.length ? "empty" : "ready");
    } catch (reason: any) {
      setError(reason.message);
      setState(reason.forbidden ? "forbidden" : "error");
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!realtime) return;
    const session = activeSession();
    if (!session.accessToken) return;
    const socket = io(`${session.api}/scheduling`, {
      auth: { token: session.accessToken },
      transports: ["websocket"],
    });
    [
      "pos.order.updated",
      "cash_session.updated",
      "appointment.updated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load, realtime]);
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
        <p>Your financial role or branch scope does not allow this view.</p>
      </div>
    );
  if (value.state === "empty")
    return (
      <div className="state">
        <h2>No {label}</h2>
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
        <a href="/admin/pos">POS</a>
        <a href="/admin/pos/orders">Orders</a>
        <a href="/admin/pos/cash-sessions">Cash sessions</a>
        <a href="/admin/financial/invoices">Invoices</a>
        <a href="/admin/financial/payments">Payments</a>
        <a href="/admin/financial/reconciliation">Reconciliation</a>
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 6 · FINANCIAL OPERATIONS</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Online-only financial commands. PostgreSQL totals and immutable
              evidence are authoritative.
            </p>
          </div>
          <span className="timezone">Online</span>
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
  }).format(value / (currency === "VND" ? 1 : 100));
function useBranch() {
  const branches = useData("/v1/branches"),
    [id, setId] = useState("");
  useEffect(() => {
    if (!id && branches.data?.[0]?.id) setId(branches.data[0].id);
  }, [branches.data, id]);
  return { branches, id, setId };
}
function BranchPicker({ branch }: { branch: ReturnType<typeof useBranch> }) {
  return (
    <label>
      Branch
      <select
        value={branch.id}
        onChange={(event) => branch.setId(event.target.value)}
      >
        <option value="">Select branch</option>
        {(branch.branches.data ?? []).map((item: any) => (
          <option key={item.id} value={item.id}>
            {item.code} · {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Sprint6Screen({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/admin/pos" || pathname === "/admin/pos/")
    return <PosHome />;
  if (pathname.startsWith("/admin/pos/checkout/"))
    return <Checkout appointmentId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/orders") return <Orders />;
  if (
    pathname.startsWith("/admin/pos/orders/") &&
    pathname.endsWith("/payment")
  )
    return <Payment orderId={parts[3] ?? ""} />;
  if (
    pathname.startsWith("/admin/pos/orders/") &&
    pathname.endsWith("/receipt")
  )
    return <Receipt orderId={parts[3] ?? ""} />;
  if (pathname.startsWith("/admin/pos/orders/"))
    return <Order orderId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/registers") return <Registers />;
  if (pathname === "/admin/pos/cash-sessions/open") return <OpenCashSession />;
  if (pathname === "/admin/pos/cash-sessions") return <CashSessions />;
  if (pathname.startsWith("/admin/pos/cash-sessions/"))
    return (
      <CashSession
        sessionId={parts[3] ?? ""}
        close={pathname.endsWith("/close")}
      />
    );
  if (pathname === "/admin/financial/invoices") return <Invoices />;
  if (pathname === "/admin/financial/payments") return <Payments />;
  return <Reconciliation />;
}
function PosHome() {
  const branch = useBranch(),
    summary = useData(
      branch.id ? `/v1/financial/summary?branchId=${branch.id}` : null,
    ),
    sessions = useData(
      branch.id ? `/v1/cash-sessions?branchId=${branch.id}&status=OPEN` : null,
    );
  return (
    <Shell title="Cashier workspace">
      <BranchPicker branch={branch} />
      <States value={summary} label="financial summary" />
      {summary.state === "ready" && (
        <div className="money-grid">
          <article>
            <small>Today sales</small>
            <strong>{money(summary.data.totals.todaySalesMinor)}</strong>
          </article>
          <article>
            <small>Paid orders</small>
            <strong>{summary.data.totals.paidOrders}</strong>
          </article>
          <article>
            <small>Tips</small>
            <strong>{money(summary.data.totals.tipsMinor)}</strong>
          </article>
          <article>
            <small>Partial orders</small>
            <strong>{summary.data.totals.partialOrders}</strong>
          </article>
        </div>
      )}
      <h2>Open cash session</h2>
      <States value={sessions} label="open cash sessions" />
      {sessions.state === "ready" &&
        sessions.data.map((item: any) => (
          <p key={item.id}>
            <a href={`/admin/pos/cash-sessions/${item.id}`}>
              {item.registerCode ?? "Register"} ·{" "}
              {money(item.expectedCashMinor, item.currency)}
            </a>
          </p>
        ))}
      <p>
        <a href="/admin/pos/cash-sessions/open">Open a cash session</a>
      </p>
    </Shell>
  );
}
function Checkout({ appointmentId }: { appointmentId: string }) {
  const appointment = useData(`/v1/appointments/${appointmentId}`),
    [order, setOrder] = useState<any>(),
    [message, setMessage] = useState("");
  async function create() {
    try {
      setOrder(
        await command(`/v1/appointments/${appointmentId}/pos-orders`, {}),
      );
      setMessage("Checkout order created from immutable service snapshots.");
    } catch (reason: any) {
      setMessage(reason.message);
    }
  }
  return (
    <Shell title="Appointment checkout">
      <States value={appointment} label="appointment" />
      {message && <p className={order ? "success" : "error"}>{message}</p>}
      {appointment.state === "ready" && (
        <section>
          <h2>{appointment.data.bookingReference}</h2>
          <p>
            {appointment.data.contact?.displayName} · {appointment.data.status}
          </p>
          <p>Checkout ready: {String(appointment.data.checkoutReady)}</p>
          <button
            disabled={!appointment.data.checkoutReady}
            onClick={() => void create()}
          >
            Create or open POS order
          </button>
        </section>
      )}
      {order && <OrderSummary order={order} />}
    </Shell>
  );
}
function Orders() {
  const branch = useBranch(),
    orders = useData(branch.id ? `/v1/pos-orders?branchId=${branch.id}` : null);
  return (
    <Shell title="POS orders">
      <BranchPicker branch={branch} />
      <States value={orders} label="orders" />
      {orders.state === "ready" && (
        <Table
          rows={orders.data}
          columns={["orderNumber", "status", "amountDueMinor"]}
          link={(row) => `/admin/pos/orders/${row.id}`}
          currency
        />
      )}
    </Shell>
  );
}
function Order({ orderId }: { orderId: string }) {
  const order = useData(`/v1/pos-orders/${orderId}`),
    [message, setMessage] = useState("");
  async function finalize() {
    try {
      await command(`/v1/pos-orders/${orderId}/finalize`, {
        version: order.data.version,
      });
      setMessage("Order finalized. Pricing mutations are closed.");
      await order.load();
    } catch (reason: any) {
      setMessage(
        reason.code?.includes("VERSION")
          ? "Version conflict; order reloaded."
          : reason.message,
      );
      await order.load();
    }
  }
  async function tip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const value = Number(
        new FormData(event.currentTarget).get("amountMinor"),
      );
      await command(`/v1/pos-orders/${orderId}/tip`, {
        version: order.data.version,
        amountMinor: value,
        source: "CASHIER_ENTRY",
        allocationBasis: "WORK_SECONDS",
      });
      setMessage("Tip allocated from actual work segments.");
      await order.load();
    } catch (reason: any) {
      setMessage(reason.message);
    }
  }
  async function discount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await command(`/v1/pos-orders/${orderId}/discounts`, {
        version: order.data.version,
        discountType: form.get("discountType"),
        value: Number(form.get("value")),
        reasonCode: "CUSTOMER_CARE",
      });
      setMessage(
        result.approvalRequired
          ? `Manager approval required: ${result.approvalRequestId}`
          : "Discount applied.",
      );
      await order.load();
    } catch (reason: any) {
      setMessage(reason.message);
    }
  }
  return (
    <Shell title="Order detail">
      <States value={order} label="order" />
      {message && (
        <p
          role="status"
          className={
            message.includes("applied") || message.includes("finalized")
              ? "success"
              : "error"
          }
        >
          {message}
        </p>
      )}
      {order.state === "ready" && (
        <>
          <OrderSummary order={order.data} />
          <section>
            <h2>Service lines</h2>
            {order.data.lines.map((line: any) => (
              <div className="receipt-line" key={line.id}>
                <span>
                  {line.description?.name?.["vi-VN"] ??
                    line.description?.name ??
                    "Service"}
                </span>
                <strong>{money(line.netMinor, order.data.currency)}</strong>
              </div>
            ))}
          </section>
          {order.data.status === "DRAFT" && (
            <div className="detail-grid">
              <form className="form-grid" onSubmit={discount}>
                <h2>Discount</h2>
                <select name="discountType">
                  <option value="FIXED">Fixed minor units</option>
                  <option value="PERCENT">Percent basis points</option>
                </select>
                <input name="value" type="number" min="0" required />
                <button>Apply / request approval</button>
              </form>
              <form className="form-grid" onSubmit={tip}>
                <h2>Tip</h2>
                <input name="amountMinor" type="number" min="0" required />
                <button>Set and allocate tip</button>
              </form>
            </div>
          )}
          {order.data.status === "DRAFT" && (
            <button onClick={() => void finalize()}>Finalize order</button>
          )}
          {["READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(
            order.data.status,
          ) && (
            <p>
              <a
                className="primary-link"
                href={`/admin/pos/orders/${orderId}/payment`}
              >
                Collect payment
              </a>
            </p>
          )}
          {order.data.status === "PAID" && (
            <p>
              <a href={`/admin/pos/orders/${orderId}/receipt`}>
                Open immutable receipt
              </a>
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
function OrderSummary({ order }: { order: any }) {
  return (
    <section className="checkout-summary">
      <div>
        <h2>{order.orderNumber}</h2>
        <p>
          {order.status} · version {order.version}
        </p>
      </div>
      <div className="totals">
        <span>
          Subtotal <b>{money(order.subtotalMinor, order.currency)}</b>
        </span>
        <span>
          Discount <b>−{money(order.discountMinor, order.currency)}</b>
        </span>
        <span>
          Tax <b>{money(order.taxMinor, order.currency)}</b>
        </span>
        <span>
          Tip <b>{money(order.tipMinor, order.currency)}</b>
        </span>
        <span className="amount-due">
          Amount due <b>{money(order.amountDueMinor, order.currency)}</b>
        </span>
      </div>
    </section>
  );
}
function Payment({ orderId }: { orderId: string }) {
  const order = useData(`/v1/pos-orders/${orderId}`),
    sessions = useData("/v1/cash-sessions?status=OPEN"),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      tender = String(form.get("tenderType")),
      amount = Number(form.get("amount"));
    let body: any = {
      version: order.data.version,
      tenderType: tender,
      amountToApplyMinor: amount,
    };
    if (tender === "CASH")
      body = {
        ...body,
        cashReceivedMinor: Number(form.get("cashReceived")),
        cashSessionId: form.get("cashSessionId"),
      };
    else if (tender === "CARD_EXTERNAL")
      body = {
        ...body,
        provider: "manual-terminal",
        providerTransactionId: form.get("reference"),
        cardLast4: form.get("last4") || undefined,
      };
    else
      body = {
        ...body,
        providerTransactionId: form.get("reference"),
        receivedAt: new Date().toISOString(),
        evidenceNote: "Verified by cashier",
      };
    try {
      const result = await command(`/v1/pos-orders/${orderId}/payments`, body);
      setMessage(
        tender === "CASH"
          ? `Captured. Change: ${money(result.payments.at(-1).changeDueMinor ?? 0, result.currency)}`
          : "External payment evidence recorded.",
      );
      await order.load();
    } catch (reason: any) {
      setMessage(
        reason.code?.includes("VERSION")
          ? "Version conflict; current due reloaded."
          : reason.message,
      );
      await order.load();
    }
  }
  return (
    <Shell title="Collect payment">
      <States value={order} label="order" />
      {message && <p role="status">{message}</p>}
      {order.state === "ready" && (
        <>
          <OrderSummary order={order.data} />
          <section>
            <h2>Captured tenders</h2>
            {order.data.payments.length ? (
              order.data.payments.map((item: any) => (
                <p key={item.id}>
                  {item.tenderType} · {money(item.capturedMinor, item.currency)}{" "}
                  · {item.status}
                </p>
              ))
            ) : (
              <p>No payment captured.</p>
            )}
          </section>
          {order.data.amountDueMinor > 0 && (
            <form className="payment-keypad" onSubmit={submit}>
              <label>
                Tender
                <select name="tenderType">
                  <option value="CASH">Cash</option>
                  <option value="CARD_EXTERNAL">External card terminal</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </label>
              <label>
                Amount to apply
                <input
                  name="amount"
                  type="number"
                  min="1"
                  max={order.data.amountDueMinor}
                  defaultValue={order.data.amountDueMinor}
                  required
                />
              </label>
              <label>
                Cash received
                <input
                  name="cashReceived"
                  type="number"
                  min="0"
                  defaultValue={order.data.amountDueMinor}
                />
              </label>
              <label>
                Open cash session
                <select name="cashSessionId">
                  <option value="">Select</option>
                  {(sessions.data ?? []).map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.registerCode ?? item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                External reference
                <input name="reference" />
              </label>
              <label>
                Card last 4 only
                <input name="last4" maxLength={4} pattern="[0-9]{4}" />
              </label>
              <button>Capture once</button>
              <p className="hint">
                Never enter PAN, CVV, PIN or magnetic-stripe data.
              </p>
            </form>
          )}
        </>
      )}
    </Shell>
  );
}
function Receipt({ orderId }: { orderId: string }) {
  const order = useData(`/v1/pos-orders/${orderId}`),
    invoiceId = order.data?.invoice?.id,
    receipt = useData(invoiceId ? `/v1/invoices/${invoiceId}/print` : null);
  return (
    <Shell title="Receipt">
      <States value={order} label="order" />
      {order.state === "ready" && !invoiceId && (
        <div className="state">Invoice is not issued.</div>
      )}
      <States value={receipt} label="receipt" />
      {receipt.state === "ready" && (
        <article className="receipt">
          <h2>{receipt.data.branchSnapshot?.name}</h2>
          <strong>{receipt.data.invoiceNumber}</strong>
          <p>
            {receipt.data.issuedAt} · {receipt.data.branchSnapshot?.timezone}
          </p>
          {receipt.data.lines.map((line: any) => (
            <div className="receipt-line" key={line.id}>
              <span>{line.description?.name?.["vi-VN"] ?? "Service"}</span>
              <b>{money(line.netMinor, receipt.data.currency)}</b>
            </div>
          ))}
          <hr />
          <p>
            Total {money(receipt.data.totalMinor, receipt.data.currency)} · Tip{" "}
            {money(receipt.data.tipMinor, receipt.data.currency)}
          </p>
          <p>Paid {money(receipt.data.paidMinor, receipt.data.currency)}</p>
          <small>Verify {receipt.data.verificationCode}</small>
          <button onClick={() => window.print()}>Print receipt</button>
        </article>
      )}
    </Shell>
  );
}
function Registers() {
  const branch = useBranch(),
    data = useData(
      branch.id ? `/v1/pos-registers?branchId=${branch.id}` : null,
    );
  return (
    <Shell title="Registers and drawers">
      <BranchPicker branch={branch} />
      <States value={data} label="registers" />
      {data.state === "ready" &&
        data.data.map((item: any) => (
          <section key={item.id}>
            <h2>
              {item.code} · {item.name}
            </h2>
            <p>
              {item.status} · binding{" "}
              {item.deviceBindingRequired ? "required" : "optional"}
            </p>
            {item.drawers.map((drawer: any) => (
              <p key={drawer.id}>
                {drawer.code} · {drawer.name} · {drawer.currency}
              </p>
            ))}
          </section>
        ))}
    </Shell>
  );
}
function CashSessions() {
  const branch = useBranch(),
    data = useData(
      branch.id ? `/v1/cash-sessions?branchId=${branch.id}` : null,
    );
  return (
    <Shell title="Cash sessions">
      <BranchPicker branch={branch} />
      <p>
        <a href="/admin/pos/cash-sessions/open">Open session</a>
      </p>
      <States value={data} label="cash sessions" />
      {data.state === "ready" && (
        <Table
          rows={data.data}
          columns={[
            "businessDate",
            "status",
            "expectedCashMinor",
            "varianceMinor",
          ]}
          link={(row) => `/admin/pos/cash-sessions/${row.id}`}
          currency
        />
      )}
    </Shell>
  );
}
function OpenCashSession() {
  const branch = useBranch(),
    registers = useData(
      branch.id ? `/v1/pos-registers?branchId=${branch.id}` : null,
    ),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const session = await command("/v1/cash-sessions/open", {
        registerId: form.get("registerId"),
        cashDrawerId: form.get("drawerId"),
        openingFloatMinor: Number(form.get("opening")),
      });
      location.href = `/admin/pos/cash-sessions/${session.id}`;
    } catch (reason: any) {
      setMessage(reason.message);
    }
  }
  const drawers = (registers.data ?? []).flatMap((item: any) =>
    item.drawers.map((drawer: any) => ({
      ...drawer,
      registerId: item.id,
      registerCode: item.code,
    })),
  );
  return (
    <Shell title="Open cash session">
      <BranchPicker branch={branch} />
      <States value={registers} label="registers" />
      {message && <p className="error">{message}</p>}
      <form className="form-grid" onSubmit={submit}>
        <label>
          Register
          <select name="registerId" required>
            {(registers.data ?? []).map((item: any) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Drawer
          <select name="drawerId" required>
            {drawers.map((item: any) => (
              <option key={item.id} value={item.id}>
                {item.registerCode} · {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opening float (minor units)
          <input name="opening" type="number" min="0" required />
        </label>
        <button>Open session</button>
      </form>
    </Shell>
  );
}
function CashSession({
  sessionId,
  close,
}: {
  sessionId: string;
  close: boolean;
}) {
  const data = useData(`/v1/cash-sessions/${sessionId}`),
    [message, setMessage] = useState("");
  async function act(action: string, body: any = {}) {
    try {
      await command(`/v1/cash-sessions/${sessionId}/${action}`, {
        version: data.data.version,
        ...body,
      });
      setMessage(`${action} completed.`);
      await data.load();
    } catch (reason: any) {
      setMessage(
        reason.code?.includes("VERSION")
          ? "Version conflict; session reloaded."
          : reason.message,
      );
      await data.load();
    }
  }
  return (
    <Shell title={close ? "Close cash session" : "Cash session detail"}>
      <States value={data} label="cash session" />
      {message && <p role="status">{message}</p>}
      {data.state === "ready" && (
        <>
          <div className="money-grid">
            <article>
              <small>Expected</small>
              <strong>
                {money(data.data.expectedCashMinor, data.data.currency)}
              </strong>
            </article>
            <article>
              <small>Declared</small>
              <strong>
                {data.data.declaredCashMinor == null
                  ? "—"
                  : money(data.data.declaredCashMinor, data.data.currency)}
              </strong>
            </article>
            <article>
              <small>Variance</small>
              <strong>
                {data.data.varianceMinor == null
                  ? "—"
                  : money(data.data.varianceMinor, data.data.currency)}
              </strong>
            </article>
          </div>
          <section>
            <h2>Movements</h2>
            {data.data.movements.map((item: any) => (
              <p key={item.id}>
                {item.movementType} · {item.direction} ·{" "}
                {money(item.amountMinor, item.currency)} · {item.reasonCode}
              </p>
            ))}
          </section>
          {data.data.status === "OPEN" && (
            <button onClick={() => void act("begin-closing")}>
              Begin closing
            </button>
          )}
          {data.data.status === "CLOSING" &&
            data.data.declaredCashMinor == null && (
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("declare", {
                    declaredCashMinor: Number(
                      new FormData(event.currentTarget).get("declared"),
                    ),
                  });
                }}
              >
                <label>
                  Declared cash
                  <input name="declared" type="number" min="0" required />
                </label>
                <button>Declare count</button>
              </form>
            )}
          {data.data.status === "CLOSING" &&
            data.data.declaredCashMinor != null && (
              <button
                onClick={() => void act("close", { approveVariance: false })}
              >
                Close session
              </button>
            )}
        </>
      )}
    </Shell>
  );
}
function Invoices() {
  const branch = useBranch(),
    data = useData(branch.id ? `/v1/invoices?branchId=${branch.id}` : null);
  return (
    <Shell title="Invoices">
      <BranchPicker branch={branch} />
      <States value={data} label="invoices" />
      {data.state === "ready" && (
        <Table
          rows={data.data}
          columns={["invoiceNumber", "status", "paidMinor"]}
          link={(row) => `/admin/pos/orders/${row.orderId}/receipt`}
          currency
        />
      )}
    </Shell>
  );
}
function Payments() {
  const data = useData("/v1/payments");
  return (
    <Shell title="Payment evidence">
      <States value={data} label="payments" />
      {data.state === "ready" && (
        <Table
          rows={data.data}
          columns={[
            "paymentReference",
            "tenderType",
            "capturedMinor",
            "status",
          ]}
          currency
        />
      )}
    </Shell>
  );
}
function Reconciliation() {
  const branch = useBranch(),
    date = new Date().toISOString().slice(0, 10),
    data = useData(
      branch.id
        ? `/v1/financial/reconciliation/daily?branchId=${branch.id}&businessDate=${date}`
        : null,
    );
  return (
    <Shell title="Daily reconciliation">
      <BranchPicker branch={branch} />
      <States value={data} label="reconciliation" />
      {data.state === "ready" && (
        <>
          <div className="money-grid">
            <article>
              <small>Gross</small>
              <strong>
                {money(data.data.grossSalesMinor, data.data.currency)}
              </strong>
            </article>
            <article>
              <small>Discount</small>
              <strong>
                {money(data.data.discountMinor, data.data.currency)}
              </strong>
            </article>
            <article>
              <small>Tax</small>
              <strong>{money(data.data.taxMinor, data.data.currency)}</strong>
            </article>
            <article>
              <small>Tips</small>
              <strong>{money(data.data.tipMinor, data.data.currency)}</strong>
            </article>
            <article>
              <small>Collected</small>
              <strong>
                {money(data.data.netCollectedMinor, data.data.currency)}
              </strong>
            </article>
            <article>
              <small>Cash variance</small>
              <strong>
                {money(data.data.cashVarianceMinor, data.data.currency)}
              </strong>
            </article>
          </div>
          <p className="hint">
            Business date {data.data.businessDate} · {data.data.timezone} ·
            half-open range {data.data.range.startUtc} →{" "}
            {data.data.range.endUtc}
          </p>
        </>
      )}
    </Shell>
  );
}
function Table({
  rows,
  columns,
  link,
  currency,
}: {
  rows: any[];
  columns: string[];
  link?: (row: any) => string;
  currency?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            {link && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              {columns.map((column) => (
                <td key={column}>
                  {currency &&
                  column.toLowerCase().includes("minor") &&
                  row[column] != null
                    ? money(row[column], row.currency)
                    : String(row[column] ?? "—")}
                </td>
              ))}
              {link && (
                <td>
                  <a href={link(row)}>Open</a>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
