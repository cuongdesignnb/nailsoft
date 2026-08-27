/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";
import { legacyColumnLabel, legacyText, legacyValue } from "./legacy-workspace-ui";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
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
      "Internet connection required. Benefit commands are not queued offline.",
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
function useData(path: string) {
  const [state, setState] = useState<State>("loading"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const value = await api(path);
      setData(value);
      const values = Array.isArray(value) ? value : value?.rows;
      setState(Array.isArray(values) && !values.length ? "empty" : "ready");
    } catch (e: any) {
      setError(e.message);
      setState(e.forbidden ? "forbidden" : "error");
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
      "voucher.updated",
      "loyalty.updated",
      "membership.updated",
      "package.updated",
      "benefits.wallet_invalidated",
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
        Đang tải {legacyText(label)}…
      </div>
    );
  if (value.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Không có quyền truy cập</h2>
        <p>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép thao tác quyền lợi này.</p>
      </div>
    );
  if (value.state === "empty")
    return (
      <div className="state">
        <h2>Chưa có {legacyText(label)}</h2>
        <p>Chưa có bản ghi trong phạm vi được cấp quyền.</p>
        <button onClick={() => void value.load()}>Làm mới</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>Không thể tải dữ liệu</h2>
      <p>{value.error}</p>
      <button onClick={() => void value.load()}>Thử lại</button>
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
      <nav className="topbar" aria-label="Điều hướng quyền lợi">
        <a href="/admin/benefits">Ví quyền lợi</a>
        <a href="/admin/vouchers/campaigns">Voucher</a>
        <a href="/admin/loyalty/programs">Loyalty</a>
        <a href="/admin/membership/tiers">Membership</a>
        <a href="/admin/packages/catalog">Gói dịch vụ</a>
        <a href="/admin/benefits/reports">Báo cáo</a>
        <a href="/admin/benefits/liability">Nghĩa vụ</a>
      </nav>
      <section className="card">
        <p className="eyebrow">NAILSOFT · QUYỀN LỢI KHÁCH HÀNG</p>
        <div className="title-row">
          <div>
            <h1>{legacyText(title)}</h1>
            <p className="hint">
              Đủ điều kiện → giữ → ghi nhận/hoàn giữ. Sổ PostgreSQL vẫn là nguồn dữ liệu chính thức.
            </p>
          </div>
          <span className="timezone">Chỉ lệnh online</span>
        </div>
        {children}
      </section>
    </main>
  );
}
const rows = (value: any) =>
  Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : [];
const label = (x: any) =>
  x.name ??
  x.code ??
  x.campaignName ??
  x.name?.["vi-VN"] ??
  x.name_json?.["vi-VN"] ??
  x.codeLast4 ??
  x.entryType ??
  x.id;

function SafeFacts({ value }: { value: any }) {
  const source = value && typeof value === "object" ? value : {};
  const entries = Object.entries(source).filter(([key]) => !/(secret|token|hash|json|email)/i.test(key)).slice(0, 14);
  return <div className="legacy-data-grid">{entries.map(([key, item]) => <div className="legacy-data-item" key={key}><span>{legacyColumnLabel(key)}</span><strong>{legacyValue(item, key)}</strong></div>)}</div>;
}

export default function Sprint8Screen({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean),
    customerId = parts[3] ?? "";
  if (pathname.startsWith("/admin/benefits/customers/") && customerId)
    return <Wallet customerId={customerId} />;
  if (pathname.includes("/pos/orders/") && pathname.endsWith("/benefits"))
    return <PosBenefits orderId={parts[3] ?? ""} />;
  if (pathname === "/admin/vouchers/campaigns")
    return (
      <Resource
        title="Voucher campaigns"
        path="/v1/voucher-campaigns"
        create={<CampaignForm />}
      />
    );
  if (pathname.startsWith("/admin/vouchers/campaigns/"))
    return (
      <Detail
        title="Voucher campaign"
        path={`/v1/voucher-campaigns/${parts[3]}`}
        actions={["activate", "pause", "end"]}
      />
    );
  if (pathname === "/admin/vouchers/codes")
    return (
      <Resource
        title="Voucher codes"
        path="/v1/voucher-codes"
        create={<VoucherCodeForm />}
      />
    );
  if (pathname === "/admin/loyalty/programs")
    return (
      <Resource
        title="Loyalty programs"
        path="/v1/loyalty-programs"
        create={<LoyaltyForm />}
      />
    );
  if (pathname === "/admin/loyalty/adjustments") return <Adjustments />;
  if (pathname.startsWith("/admin/loyalty/customers/") && customerId)
    return (
      <Resource
        title="Customer loyalty ledger"
        path={`/v1/customers/${customerId}/loyalty/ledger`}
      />
    );
  if (pathname === "/admin/membership/tiers")
    return (
      <Resource
        title="Membership tiers"
        path="/v1/membership-tiers"
        create={<TierForm />}
      />
    );
  if (pathname.startsWith("/admin/membership/customers/") && customerId)
    return (
      <Resource
        title="Membership history"
        path={`/v1/customers/${customerId}/membership`}
      />
    );
  if (pathname === "/admin/packages/catalog")
    return (
      <Resource
        title="Service package catalog"
        path="/v1/service-packages"
        create={<PackageForm />}
      />
    );
  if (pathname.startsWith("/admin/packages/catalog/"))
    return (
      <Detail
        title="Service package"
        path={`/v1/service-packages/${parts[3]}`}
        actions={["activate", "deactivate"]}
      />
    );
  if (pathname === "/admin/packages/entitlements") return <CustomerLookup />;
  if (pathname.startsWith("/admin/packages/entitlements/"))
    return (
      <Resource
        title="Package ledger"
        path={`/v1/customer-packages/${parts[3]}/ledger`}
      />
    );
  if (pathname === "/admin/benefits/liability")
    return (
      <Resource
        title="Benefit liability"
        path="/v1/benefits/reports/liability"
      />
    );
  if (pathname.startsWith("/admin/benefits/reports")) return <Reports />;
  return <BenefitHome />;
}
function Resource({
  title,
  path,
  create,
}: {
  title: string;
  path: string;
  create?: React.ReactNode;
}) {
  const value = useData(path);
  return (
    <Shell title={title}>
      {create}
      <States value={value} label={title.toLowerCase()} />
      {value.state === "ready" && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Bảng dữ liệu quyền lợi">
          <table>
            <thead>
              <tr>
                <th scope="col">Tên / tham chiếu</th>
                <th scope="col">Trạng thái / loại</th>
                <th scope="col">Số dư / sử dụng</th>
                <th scope="col">Hạn dùng</th>
              </tr>
            </thead>
            <tbody>
              {rows(value.data).map((item: any) => (
                <tr key={item.id ?? label(item)}>
                  <td data-label="Tên / tham chiếu">{legacyValue(label(item), "reference")}</td>
                  <td data-label="Trạng thái / loại">
                    <span className="pill">
                      {legacyValue(item.status ?? item.entryType ?? item.type ?? "ACTIVE", "status")}
                    </span>
                  </td>
                  <td data-label="Số dư / sử dụng">
                    {legacyValue(item.availablePoints ??
                      item.availableUnits ??
                      item.usedCount ??
                      item.redeemedCount ??
                      item.amountMinor ??
                      "—", "amountMinor")}
                  </td>
                  <td data-label="Hạn dùng">
                    {item.expiresAt
                      ? new Date(item.expiresAt).toLocaleString()
                      : "Không hết hạn"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {value.state === "ready" && !Array.isArray(value.data) && (
        <SafeFacts value={value.data} />
      )}
    </Shell>
  );
}
function Detail({
  title,
  path,
  actions,
}: {
  title: string;
  path: string;
  actions: string[];
}) {
  const value = useData(path),
    [message, setMessage] = useState("");
  async function act(action: string) {
    try {
      await command(`${path}/${action}`, {
        version: value.data.version,
        reason: "Admin benefit lifecycle action",
      });
      setMessage("Action completed.");
      await value.load();
    } catch (e: any) {
      setMessage(
        e.code === "BENEFIT_VERSION_CONFLICT"
          ? "Version conflict. Data refreshed; retry."
          : e.message,
      );
      await value.load();
    }
  }
  return (
    <Shell title={title}>
      <States value={value} label="detail" />
      {message && <p role="status">{message}</p>}
      {value.state === "ready" && (
        <>
          <div className="actions">
            {actions.map((a) => (
              <button key={a} onClick={() => void act(a)}>
                {a}
              </button>
            ))}
          </div>
          <SafeFacts value={value.data} />
        </>
      )}
    </Shell>
  );
}
function CampaignForm() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await command("/v1/voucher-campaigns", {
        name: f.get("name"),
        discountType: f.get("type"),
        discountValue: Number(f.get("value")),
        currency: "VND",
        minimumSpendMinor: Number(f.get("minimum")),
        branchIds: [],
        serviceIds: [],
        customerIds: [],
        membershipTierIds: [],
        eligibilityPolicy: {},
        refundPolicy: "RESTORE_USE",
        validFrom: new Date(String(f.get("from"))).toISOString(),
        validUntil: new Date(String(f.get("until"))).toISOString(),
      });
      setMessage("Campaign created. Refresh to view it.");
      e.currentTarget.reset();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Type
        <select name="type">
          <option>FIXED</option>
          <option>PERCENT</option>
        </select>
      </label>
      <label>
        Value
        <input name="value" type="number" min="1" required />
      </label>
      <label>
        Minimum spend
        <input name="minimum" type="number" min="0" defaultValue="0" />
      </label>
      <label>
        Valid from
        <input name="from" type="datetime-local" required />
      </label>
      <label>
        Valid until
        <input name="until" type="datetime-local" required />
      </label>
      <button type="submit">Create draft campaign</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function VoucherCodeForm() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const value = await command(
        `/v1/voucher-campaigns/${f.get("campaignId")}/codes`,
        { code: f.get("code"), useLimit: 1 },
      );
      setMessage(`Code issued securely · last4 ${value.codeLast4}`);
      e.currentTarget.reset();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label>
        Campaign ID
        <input name="campaignId" required />
      </label>
      <label>
        Voucher code
        <input name="code" minLength={4} required autoComplete="off" />
      </label>
      <button type="submit">Issue hashed code</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function LoyaltyForm() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await command("/v1/loyalty-programs", {
        name: f.get("name"),
        earnBasis: "NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP",
        spendMinorPerPoint: Number(f.get("spend")),
        redemptionPoints: Number(f.get("points")),
        redemptionMinor: Number(f.get("minor")),
        settlementDelayHours: 24,
        pointsValidDays: 365,
        effectiveFrom: new Date(String(f.get("from"))).toISOString(),
        policy: {},
      });
      setMessage("Loyalty program created.");
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Spend minor/point
        <input name="spend" type="number" min="1" required />
      </label>
      <label>
        Redemption points
        <input name="points" type="number" min="1" required />
      </label>
      <label>
        Redemption minor
        <input name="minor" type="number" min="1" required />
      </label>
      <label>
        Effective from
        <input name="from" type="datetime-local" required />
      </label>
      <button type="submit">Create program</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function TierForm() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await command("/v1/membership-tiers", {
        code: f.get("code"),
        name: { "vi-VN": f.get("name") },
        qualificationType: f.get("type"),
        qualificationThreshold: Number(f.get("threshold")),
        benefits: [
          { type: "PERCENT_DISCOUNT", value: Number(f.get("discount")) },
        ],
        priority: Number(f.get("priority")),
        effectiveFrom: new Date(String(f.get("from"))).toISOString(),
      });
      setMessage("Tier created.");
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label>
        Code
        <input name="code" required />
      </label>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Qualification
        <select name="type">
          <option>ROLLING_SPEND</option>
          <option>VISIT_COUNT</option>
          <option>MANUAL</option>
        </select>
      </label>
      <label>
        Threshold
        <input name="threshold" type="number" min="0" required />
      </label>
      <label>
        Discount basis points
        <input name="discount" type="number" min="0" max="10000" required />
      </label>
      <label>
        Priority
        <input name="priority" type="number" defaultValue="0" />
      </label>
      <label>
        Effective from
        <input name="from" type="datetime-local" required />
      </label>
      <button type="submit">Create tier</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function PackageForm() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await command("/v1/service-packages", {
        code: f.get("code"),
        name: { "vi-VN": f.get("name") },
        description: {},
        grantedUnits: Number(f.get("units")),
        unitsPerRedemption: 1,
        priceMinor: Number(f.get("price")),
        currency: "VND",
        validityDays: Number(f.get("days")),
        refundPolicy: "RESTORE_UNIT",
        policy: {},
        eligibility: [{ serviceId: f.get("serviceId"), unitsPerRedemption: 1 }],
      });
      setMessage("Package draft created.");
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <form className="form-grid" onSubmit={(e) => void submit(e)}>
      <label>
        Code
        <input name="code" required />
      </label>
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Units
        <input name="units" type="number" min="1" required />
      </label>
      <label>
        Price minor
        <input name="price" type="number" min="0" required />
      </label>
      <label>
        Validity days
        <input name="days" type="number" min="1" required />
      </label>
      <label>
        Eligible service ID
        <input name="serviceId" required />
      </label>
      <button type="submit">Create package</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function Wallet({ customerId }: { customerId: string }) {
  const [value, setValue] = useState<ReturnType<typeof useData> | null>(null);
  const resource = useData(`/v1/customers/${customerId}/loyalty`);
  useEffect(() => setValue(resource), [resource.state, resource.data]);
  const vouchers = useData(`/v1/customers/${customerId}/vouchers`),
    membership = useData(`/v1/customers/${customerId}/membership`),
    packages = useData(`/v1/customers/${customerId}/packages`);
  return (
    <Shell title="Customer benefit wallet">
      <States value={value ?? resource} label="wallet" />
      <div className="form-grid">
        <section>
          <h2>Loyalty</h2>
          <SafeFacts value={resource.data} />
        </section>
        <section>
          <h2>Membership</h2>
          <SafeFacts value={membership.data} />
        </section>
        <section>
          <h2>Voucher</h2>
          <SafeFacts value={vouchers.data} />
        </section>
        <section>
          <h2>Gói dịch vụ</h2>
          <SafeFacts value={packages.data} />
        </section>
      </div>
    </Shell>
  );
}
function Adjustments() {
  const value = useData("/v1/loyalty-adjustments"),
    [message, setMessage] = useState("");
  async function decide(item: any, action: string) {
    try {
      await command(`/v1/loyalty-adjustments/${item.id}/${action}`, {
        version: item.version,
        reason: `Thao tác ${action} bởi người phê duyệt được cấp quyền`,
      });
      setMessage("Quyết định đã được ghi nhận theo cơ chế phê duyệt kép.");
      await value.load();
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  return (
    <Shell title="Loyalty adjustments">
      <States value={value} label="adjustments" />
      {message && <p role="status">{message}</p>}
      {value.state === "ready" &&
        rows(value.data).map((x: any) => (
          <article className="state" key={x.id}>
            <strong>
              {x.points_delta} points · {x.status}
            </strong>
            {x.status === "PENDING" && (
              <div className="actions">
                <button onClick={() => void decide(x, "approve")}>
                  Approve
                </button>
                <button onClick={() => void decide(x, "reject")}>Reject</button>
              </div>
            )}
          </article>
        ))}
    </Shell>
  );
}
function PosBenefits({ orderId }: { orderId: string }) {
  const eligibility = useData(`/v1/pos-orders/${orderId}/benefits/eligibility`),
    applied = useData(`/v1/pos-orders/${orderId}/benefits`),
    order = useData(`/v1/pos-orders/${orderId}`),
    [message, setMessage] = useState(""),
    [voucherCode, setVoucherCode] = useState(""),
    [points, setPoints] = useState(0);
  const voucher = eligibility.data?.vouchers?.find((x: any) => x.eligible),
    membership = eligibility.data?.membership,
    packageCandidate = eligibility.data?.packages?.find((x: any) => x.eligible),
    line = order.data?.lines?.find(
      (x: any) => x.serviceId === packageCandidate?.serviceId,
    );
  async function reload() {
    await Promise.all([order.load(), eligibility.load(), applied.load()]);
  }
  async function mutate(type: string, body: Record<string, unknown>) {
    try {
      await command(`/v1/pos-orders/${orderId}/benefits/${type}`, {
        version: order.data.version,
        ...body,
      });
      setMessage("Quyền lợi đã áp dụng; đơn POS được tính lại.");
      await reload();
    } catch (e: any) {
      setMessage(
        e.code === "BENEFIT_VERSION_CONFLICT"
          ? "Đơn POS vừa thay đổi. Dữ liệu đã tải lại; hãy thử lại."
          : e.message,
      );
      await reload();
    }
  }
  async function release(item: any) {
    try {
      await command(`/v1/pos-orders/${orderId}/benefits/${item.id}/release`, {
        version: order.data.version,
      });
      setMessage("Đã hoàn giữ quyền lợi; đơn POS được tính lại.");
      await reload();
    } catch (e: any) {
      setMessage(
        e.code === "BENEFIT_VERSION_CONFLICT"
          ? "Đơn POS vừa thay đổi. Dữ liệu đã tải lại; hãy thử lại."
          : e.message,
      );
      await reload();
    }
  }
  return (
    <Shell title="Quyền lợi khách hàng">
      <States value={eligibility} label="eligibility" />
      <States value={order} label="order" />
      {message && <p role="status">{message}</p>}
      <p>Thứ tự áp dụng tại POS: gói dịch vụ → Membership → Voucher → Loyalty → thuế → tip.</p>
      {order.state === "ready" && (
        <p>
          <strong>{order.data.orderNumber}</strong> · phiên bản {order.data.version} · còn phải thu {order.data.amountDueMinor}{" "}
          {order.data.currency}
        </p>
      )}
      <div className="form-grid">
        <section className="state">
          <h2>Gói dịch vụ</h2>
          <p>
            {packageCandidate
              ? `${packageCandidate.calculatedUnits} đơn vị phù hợp với dịch vụ này.`
              : "Không có gói đủ điều kiện."}
          </p>
          <button
            disabled={
              !packageCandidate || !line || order.data?.status !== "DRAFT"
            }
            onClick={() =>
              void mutate("package", {
                entitlementId: packageCandidate.id,
                orderLineId: line?.id,
                units: packageCandidate?.calculatedUnits ?? 1,
              })
            }
          >
            Áp dụng gói
          </button>
        </section>
        <section className="state">
          <h2>Membership</h2>
          <p>
            {membership?.tierId
              ? "Quyền lợi cấp Membership đang khả dụng."
              : "Chưa có cấp Membership đang hoạt động."}
          </p>
          <button
            disabled={!membership?.tierId || order.data?.status !== "DRAFT"}
            onClick={() =>
              void mutate("membership", {
                assignmentId: membership?.assignmentId,
              })
            }
          >
            Áp dụng Membership
          </button>
        </section>
        <section className="state">
          <h2>Voucher</h2>
          {voucher && (
            <p>
              Mã đủ điều kiện có 4 số cuối {voucher.codeLast4}; giá trị tính toán {voucher.calculatedAmountMinor} minor.
            </p>
          )}
          <label>
            Mã Voucher
            <input
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            disabled={
              voucherCode.trim().length < 4 || order.data?.status !== "DRAFT"
            }
            onClick={() => void mutate("voucher", { code: voucherCode.trim() })}
          >
            Áp dụng Voucher
          </button>
        </section>
        <section className="state">
          <h2>Loyalty</h2>
          <p>
            Tối đa {eligibility.data?.loyalty?.maxRedeemablePoints ?? 0} điểm có thể dùng.
          </p>
          <label>
            Điểm
            <input
              type="number"
              min="1"
              max={eligibility.data?.loyalty?.maxRedeemablePoints ?? 0}
              value={points || ""}
              onChange={(e) => setPoints(Number(e.target.value))}
            />
          </label>
          <button
            disabled={
              points < 1 ||
              points > (eligibility.data?.loyalty?.maxRedeemablePoints ?? 0) ||
              order.data?.status !== "DRAFT"
            }
            onClick={() => void mutate("loyalty", { points })}
          >
            Áp dụng điểm
          </button>
        </section>
      </div>
      <h2>Quyền lợi đã giữ</h2>
      {applied.state === "empty" && <p>Chưa có quyền lợi nào được áp dụng.</p>}
      {rows(applied.data).map((x: any) => (
        <article className="state" key={x.id}>
          <strong>{x.benefitType}</strong> · {x.amountMinor} · {x.status}
          <button
            disabled={x.status !== "RESERVED" || order.data?.status !== "DRAFT"}
            onClick={() => void release(x)}
          >
            Hoàn giữ
          </button>
        </article>
      ))}
    </Shell>
  );
}
function Reports() {
  const options = useMemo(
    () => [
      { name: "Hiệu quả Voucher", path: "vouchers" },
      { name: "Nghĩa vụ Loyalty", path: "loyalty" },
      { name: "Số lượng Membership", path: "membership" },
      { name: "Nghĩa vụ gói dịch vụ", path: "packages" },
      { name: "Quyền lợi sắp hết hạn", path: "expiring" },
    ],
    [],
  );
  return (
    <Shell title="Báo cáo quyền lợi">
      <div className="form-grid">
        {options.map((x) => (
          <ReportCard key={x.path} {...x} />
        ))}
      </div>
    </Shell>
  );
}
function ReportCard({ name, path }: { name: string; path: string }) {
  const value = useData(`/v1/benefits/reports/${path}`);
  return (
    <section className="state">
      <h2>{name}</h2>
      <States value={value} label={name.toLowerCase()} />
      {value.state === "ready" && <SafeFacts value={value.data} />}
    </section>
  );
}
function CustomerLookup() {
  const [id, setId] = useState("");
  return (
    <Shell title="Quyền lợi gói dịch vụ">
      <label>
        Khách hàng
        <input value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      {id && (
        <a className="button" href={`/admin/benefits/customers/${id}`}>
          Mở ví quyền lợi
        </a>
      )}
    </Shell>
  );
}
function BenefitHome() {
  return (
    <Shell title="Trung tâm quyền lợi khách hàng">
      <div className="form-grid">
        <a className="state" href="/admin/vouchers/campaigns">
          <h2>Voucher</h2>
          <p>Chiến dịch, mã đã che và giới hạn sử dụng.</p>
        </a>
        <a className="state" href="/admin/loyalty/programs">
          <h2>Loyalty</h2>
          <p>Chương trình, tài khoản, sổ giao dịch và kiểm soát kép.</p>
        </a>
        <a className="state" href="/admin/membership/tiers">
          <h2>Membership</h2>
          <p>Hạng có phiên bản và phân bổ có hiệu lực.</p>
        </a>
        <a className="state" href="/admin/packages/catalog">
          <h2>Gói dịch vụ</h2>
          <p>Quyền sử dụng theo lượt và giữ chỗ tại lịch hẹn/POS.</p>
        </a>
      </div>
    </Shell>
  );
}
