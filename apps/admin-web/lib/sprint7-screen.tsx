/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";
import { LegacyDataTable, legacyText, legacyValue } from "./legacy-workspace-ui";

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
        Đang tải {legacyText(label)}…
      </div>
    );
  if (value.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Không có quyền truy cập</h2>
        <p>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</p>
      </div>
    );
  if (value.state === "empty")
    return (
      <div className="state">
        <h2>Chưa có {legacyText(label)}</h2>
        <p>Chưa có bản ghi phù hợp trong phạm vi hiện tại.</p>
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
      <nav className="topbar">
        <a href="/admin/refunds">Hoàn tiền</a>
        <a href="/admin/credit-notes">Credit Note</a>
        <a href="/admin/commission/rules">Quy tắc hoa hồng</a>
        <a href="/admin/commission/entries">Bút toán</a>
        <a href="/admin/commission/periods">Kỳ hoa hồng</a>
        <a href="/admin/commission/adjustments">Điều chỉnh</a>
        <a href="/admin/financial/refunds">Báo cáo</a>
      </nav>
      <section className="card">
        <p className="eyebrow">TÀI CHÍNH · KIỂM SOÁT & ĐIỀU CHỈNH</p>
        <div className="title-row">
          <div>
            <h1>{legacyText(title)}</h1>
            <p className="hint">
              Hóa đơn và thanh toán đã ghi nhận là bằng chứng bất biến; dữ liệu
              máy chủ là nguồn chính thức.
            </p>
          </div>
          <span className="timezone">Chỉ thao tác khi trực tuyến</span>
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
  legacyValue(item.id, "id");

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
    return <CommissionRuleDetail id={parts[3]} />;
  if (pathname === "/admin/commission/rules")
    return <CommissionRules />;
  if (pathname === "/admin/commission/entries")
    return (
      <Resource title="Commission entries" path="/v1/commission-entries" />
    );
  if (pathname.startsWith("/admin/commission/periods/") && parts[3])
    return <Period id={parts[3]} />;
  if (pathname === "/admin/commission/periods") return <Periods />;
  if (pathname === "/admin/commission/adjustments") return <Adjustments />;
  if (pathname.startsWith("/admin/financial/exports/") && parts[3])
    return <FinancialExportDetail id={parts[3]} />;
  if (pathname === "/admin/financial/exports") return <FinancialExports />;
  if (pathname === "/admin/financial/refunds") return <RefundReport />;
  return <Reports pathname={pathname} />;
}

function commissionRuleStatus(value: any) {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  return {
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Không hoạt động",
    UNKNOWN: "Chưa xác định",
  }[status] ?? legacyText(status);
}

function commissionRuleType(value: any) {
  const type = String(value ?? "").toUpperCase();
  return {
    SERVICE_PERCENT: "Theo tỷ lệ dịch vụ",
    SERVICE_FIXED: "Mức cố định theo dịch vụ",
  }[type] ?? legacyText(type || "Chưa xác định");
}

function commissionRuleBaseMode(value: any) {
  const mode = String(value ?? "").toUpperCase();
  return {
    NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX: "Giá dịch vụ sau giảm, trước thuế",
    GROSS_SERVICE_BEFORE_DISCOUNT: "Giá dịch vụ trước giảm",
    FIXED_PER_COMPLETED_SERVICE: "Mức cố định theo dịch vụ hoàn tất",
  }[mode] ?? legacyText(mode || "Chưa xác định");
}

function commissionRuleScope(rule: any) {
  if (rule.branchId) return "Chi nhánh cụ thể";
  if (rule.staffId) return "Nhân sự cụ thể";
  if (rule.serviceId) return "Dịch vụ cụ thể";
  return "Toàn salon";
}

function commissionRuleEffectiveDate(value: any) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value)) : "Không giới hạn";
}

function commissionPeriodStatus(value: any) {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  return {
    OPEN: "Đang mở",
    REVIEW: "Đang rà soát",
    LOCKED: "Đã khóa",
    UNKNOWN: "Chưa xác định",
  }[status] ?? legacyText(status);
}

function commissionPeriodDate(value: any) {
  const raw = String(value ?? "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function commissionPeriodTotal(period: any) {
  const total = period?.totals?.payableMinor ?? period?.totals?.payable_minor;
  return total == null ? "Chưa chốt" : money(Number(total), period.currency);
}

function CommissionRules() {
  const value = useData("/v1/commission-rules");
  const records = rows(value.data);
  return (
    <Shell title="Quy tắc hoa hồng">
      <div className="actions">
        <a className="button" href="/admin/commission">Tổng quan hoa hồng</a>
        <a className="button" href="/admin/commission/rules/new">Tạo phiên bản quy tắc</a>
      </div>
      <States value={value} label="quy tắc hoa hồng" />
      {value.state === "ready" && (
        <>
          <div className="money-grid">
            <article><small>Quy tắc trong phạm vi</small><strong>{records.length}</strong></article>
            <article><small>Đang hoạt động</small><strong>{records.filter((item: any) => item.status === "ACTIVE").length}</strong></article>
            <article><small>Phiên bản cần rà soát</small><strong>{records.filter((item: any) => item.status !== "ACTIVE").length}</strong></article>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mã quy tắc</th>
                  <th scope="col">Phạm vi áp dụng</th>
                  <th scope="col">Cách tính</th>
                  <th scope="col">Mức hoa hồng</th>
                  <th scope="col">Hiệu lực từ</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rule: any) => (
                  <tr key={rule.id}>
                    <td><strong>{rule.ruleCode ?? legacyValue(rule.id, "id")}</strong><small>Ưu tiên {rule.priority ?? "—"}</small></td>
                    <td>{commissionRuleScope(rule)}</td>
                    <td>{commissionRuleType(rule.ruleType)}<small>{legacyText(rule.baseMode ?? "")}</small></td>
                    <td>{rule.percentBasisPoints != null ? `${Number(rule.percentBasisPoints) / 100}%` : money(rule.fixedMinor, rule.currency)}</td>
                    <td>{commissionRuleEffectiveDate(rule.effectiveFrom)}</td>
                    <td><span className="pill">{commissionRuleStatus(rule.status)}</span></td>
                    <td><a href={`/admin/commission/rules/${rule.id}`}>Xem chi tiết</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

function CommissionRuleDetail({ id }: { id: string }) {
  const value = useData(`/v1/commission-rules/${id}`);
  return (
    <Shell title="Chi tiết quy tắc hoa hồng">
      <p><a href="/admin/commission/rules">← Quay lại danh sách quy tắc</a></p>
      <States value={value} label="quy tắc hoa hồng" />
      {value.state === "ready" && (
        <>
          <div className="money-grid">
            <article><small>Mã quy tắc</small><strong>{value.data.ruleCode ?? legacyValue(value.data.id, "id")}</strong></article>
            <article><small>Trạng thái</small><strong>{commissionRuleStatus(value.data.status)}</strong></article>
            <article><small>Phiên bản</small><strong>{value.data.version ?? "—"}</strong></article>
          </div>
          <section className="state">
            <h2>Phạm vi và công thức</h2>
            <dl className="summary-list">
              <div><dt>Phạm vi</dt><dd>{commissionRuleScope(value.data)}</dd></div>
              <div><dt>Cách tính</dt><dd>{commissionRuleType(value.data.ruleType)}</dd></div>
              <div><dt>Nền tính</dt><dd>{commissionRuleBaseMode(value.data.baseMode)}</dd></div>
              <div><dt>Mức hoa hồng</dt><dd>{value.data.percentBasisPoints != null ? `${Number(value.data.percentBasisPoints) / 100}%` : money(value.data.fixedMinor, value.data.currency)}</dd></div>
              <div><dt>Hiệu lực từ</dt><dd>{commissionRuleEffectiveDate(value.data.effectiveFrom)}</dd></div>
              <div><dt>Hiệu lực đến</dt><dd>{commissionRuleEffectiveDate(value.data.effectiveTo)}</dd></div>
            </dl>
          </section>
          <p className="hint">Quy tắc đã ghi nhận không được sửa trực tiếp; thay đổi phải tạo một phiên bản có hiệu lực mới theo quyền được cấp.</p>
        </>
      )}
    </Shell>
  );
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
            Tạo mới
          </a>
        </p>
      )}
      <States value={value} label={title.toLowerCase()} />
      {value.state === "ready" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tham chiếu</th>
                <th>Trạng thái</th>
                <th>Số tiền</th>
                <th>Tiền tệ</th>
                <th>Thao tác</th>
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
                      <a href={`/admin/refunds/${item.id}`}>Xem chi tiết</a>
                    ) : item.creditNoteNumber ? (
                      <a href={`/admin/credit-notes/${item.id}`}>Xem chi tiết</a>
                    ) : item.ruleCode ? (
                      <a href={`/admin/commission/rules/${item.id}`}>Xem chi tiết</a>
                    ) : (
                      "Bất biến"
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
          Mã hóa đơn
          <input
            required
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          />
        </label>
        <label>
          Mã dòng hóa đơn
          <input
            required
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
          />
        </label>
        <label>
          Số tiền hoàn của dòng (minor)
          <input
            required
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Hoàn tiền tip (minor)
          <input
            type="number"
            min="0"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
          />
        </label>
        <label>
          Lý do
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>CUSTOMER_REQUEST</option>
            <option>SERVICE_QUALITY</option>
            <option>DUPLICATE_CHARGE</option>
          </select>
        </label>
        <button type="submit">Kiểm tra số tiền theo máy chủ</button>
      </form>
      {message && <p role="alert">{message}</p>}
      {preview && (
        <section className="state">
          <h2>Xem trước phê duyệt</h2>
          <p>
            {money(preview.requestedMinor, preview.currency)} ·{" "}
            {preview.approval.required
              ? "Cần phê duyệt"
              : "Được phép thực hiện theo chính sách"}
          </p>
          <p>
            Phân bổ phương thức thanh toán gốc:{" "}
            {preview.paymentAllocations
              .map(
                (x: any) =>
                  `${x.tenderType} ${money(x.plannedMinor, preview.currency)}`,
              )
              .join(", ")}
          </p>
          <button onClick={() => void create()}>Tạo bản nháp</button>
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
          ? "Phê duyệt hoàn tiền"
          : mode === "execute"
            ? "Thực hiện hoàn tiền"
            : "Chi tiết hoàn tiền"
      }
    >
      <States value={value} label="refund" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <div className="money-grid">
            <article>
              <small>Đã yêu cầu</small>
              <strong>
                {money(value.data.requestedMinor, value.data.currency)}
              </strong>
            </article>
            <article>
              <small>Đã hoàn tất</small>
              <strong>
                {money(value.data.completedMinor, value.data.currency)}
              </strong>
            </article>
            <article>
              <small>Trạng thái</small>
              <strong>{value.data.status}</strong>
            </article>
          </div>
          <p>
            Hóa đơn: {legacyValue(value.data.invoiceId, "invoiceId")} · Lý do: {legacyText(value.data.reasonCode ?? "—")}
          </p>
          <div className="actions">
            <button onClick={() => void act("submit")}>Gửi duyệt</button>
            <button
              onClick={() =>
                void act("approve", {
                  reason: "Approved after evidence review",
                })
              }
            >
              Phê duyệt
            </button>
            <button
              onClick={() =>
                void act("reject", { reason: "Evidence is insufficient" })
              }
            >
              Từ chối
            </button>
            <button
              onClick={() =>
                void act("cancel", { reason: "Request cancelled" })
              }
            >
              Hủy
            </button>
          </div>
          <details>
            <summary>Bằng chứng dòng và phương thức thanh toán</summary>
            <LegacyDataTable rows={[{ items: value.data.items, paymentAllocations: value.data.paymentAllocations, creditNote: value.data.creditNote }]} />
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
    <Shell title="Credit Note bất biến">
      <States value={value} label="credit note" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <h2>{value.data.creditNoteNumber}</h2>
          <p>
            Hóa đơn gốc: {legacyValue(value.data.originalInvoiceId, "originalInvoiceId")} · Hoàn tiền:{" "}
            {legacyValue(value.data.refundId, "refundId")}
          </p>
          <strong>{money(value.data.totalMinor, value.data.currency)}</strong>
          <div className="actions">
            <button onClick={() => void deliver("PRINT")}>In chứng từ</button>
            <button onClick={() => void deliver("EMAIL")}>Gửi chứng từ</button>
          </div>
          <LegacyDataTable rows={value.data.lines ?? []} />
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
      percentBasisPoints: "",
      fixedMinor: "",
      currency: "VND",
      priority: "0",
      effectiveFrom: "",
      effectiveTo: "",
    }),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const toIso = (value: string) => (value ? new Date(value).toISOString() : undefined);
      const result = await command("/v1/commission-rules", {
        ruleCode: form.ruleCode,
        ruleType: form.ruleType,
        baseMode: form.baseMode,
        percentBasisPoints: form.ruleType === "SERVICE_PERCENT" ? Number(form.percentBasisPoints) : undefined,
        fixedMinor: form.ruleType === "SERVICE_FIXED" ? Number(form.fixedMinor) : undefined,
        currency: form.ruleType === "SERVICE_FIXED" ? form.currency : undefined,
        priority: Number(form.priority),
        effectiveFrom: toIso(form.effectiveFrom),
        effectiveTo: toIso(form.effectiveTo),
        policy: {},
      });
      location.href = `/admin/commission/rules/${result.id}`;
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Tạo quy tắc hoa hồng">
      <form className="form-grid" onSubmit={submit}>
        <label>
          Mã quy tắc
          <input
            required
            value={form.ruleCode}
            onChange={(e) => setForm({ ...form, ruleCode: e.target.value })}
          />
        </label>
        <label>
          Loại quy tắc
          <select
            value={form.ruleType}
            onChange={(e) => setForm({ ...form, ruleType: e.target.value })}
          >
            <option value="SERVICE_PERCENT">Theo tỷ lệ dịch vụ</option>
            <option value="SERVICE_FIXED">Mức cố định theo dịch vụ</option>
          </select>
        </label>
        <label>
          Cách tính nền
          <select
            value={form.baseMode}
            onChange={(e) => setForm({ ...form, baseMode: e.target.value })}
          >
            <option value="NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX">Giá dịch vụ sau giảm, trước thuế</option>
            <option value="GROSS_SERVICE_BEFORE_DISCOUNT">Giá dịch vụ trước giảm</option>
            <option value="FIXED_PER_COMPLETED_SERVICE">Mức cố định theo dịch vụ hoàn tất</option>
          </select>
        </label>
        {form.ruleType === "SERVICE_PERCENT" ? (
          <label>
            Tỷ lệ hoa hồng (điểm cơ sở)
            <input
              required
              type="number"
              min="0"
              max="10000"
              value={form.percentBasisPoints}
              onChange={(e) => setForm({ ...form, percentBasisPoints: e.target.value })}
              placeholder="Ví dụ: 1000 = 10%"
            />
          </label>
        ) : (
          <>
            <label>
              Mức cố định (đơn vị nhỏ nhất)
              <input
                required
                type="number"
                min="0"
                value={form.fixedMinor}
                onChange={(e) => setForm({ ...form, fixedMinor: e.target.value })}
                placeholder="Nhập số tiền theo đơn vị nhỏ nhất"
              />
            </label>
            <label>
              Tiền tệ
              <input
                required
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </label>
          </>
        )}
        <label>
          Độ ưu tiên
          <input
            type="number"
            value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </label>
        <label>
          Có hiệu lực từ
          <input
            required
            type="datetime-local"
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
          />
        </label>
        <label>
          Có hiệu lực đến (không bắt buộc)
          <input
            type="datetime-local"
            value={form.effectiveTo}
            min={form.effectiveFrom || undefined}
            onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
          />
        </label>
        <button type="submit">Tạo phiên bản bất biến</button>
      </form>
      {message && <p role="alert">{message}</p>}
    </Shell>
  );
}

function Periods() {
  const value = useData("/v1/commission-periods"),
    [form, setForm] = useState({ code: "", startDate: "", endDate: "", currency: "VND" }),
    [message, setMessage] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await command("/v1/commission-periods", {
        code: form.code,
        startDate: form.startDate,
        endDate: form.endDate,
        currency: form.currency,
      });
      setForm({ code: "", startDate: "", endDate: "", currency: "VND" });
      await value.load();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Kỳ hoa hồng">
      <div className="actions">
        <a className="button" href="/admin/financial/commission">Mở trung tâm hoa hồng</a>
        <a className="button" href="/admin/commission/rules">Xem quy tắc áp dụng</a>
      </div>
      <details className="period-create">
        <summary>Tạo kỳ hoa hồng</summary>
        <form className="form-grid" onSubmit={create}>
          <label>
            Mã kỳ
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Nhập mã kỳ"
            />
          </label>
          <label>
            Bắt đầu từ
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            Kết thúc vào
            <input
              required
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </label>
          <label>
            Tiền tệ
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="VND">VND</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <button type="submit">Tạo kỳ hoa hồng</button>
        </form>
      </details>
      {message && <p role="alert">{message}</p>}
      <States value={value} label="kỳ hoa hồng" />
      {value.state === "ready" && (() => {
        const records = rows(value.data);
        return (
          <>
            <div className="metric-grid" aria-label="Tổng quan kỳ hoa hồng">
              <article className="metric-card"><span>Tổng số kỳ</span><strong>{records.length}</strong><small>Trong phạm vi hiện tại</small></article>
              <article className="metric-card"><span>Đang mở</span><strong>{records.filter((p: any) => p.status === "OPEN").length}</strong><small>Chưa bắt đầu rà soát</small></article>
              <article className="metric-card"><span>Đang rà soát</span><strong>{records.filter((p: any) => p.status === "REVIEW").length}</strong><small>Chờ kiểm tra bằng chứng</small></article>
              <article className="metric-card"><span>Đã khóa</span><strong>{records.filter((p: any) => p.status === "LOCKED").length}</strong><small>Snapshot bất biến</small></article>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Mã kỳ</th>
                    <th scope="col">Khoảng thời gian</th>
                    <th scope="col">Tiền tệ</th>
                    <th scope="col">Tổng phải trả</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Phiên bản</th>
                    <th scope="col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((p: any) => (
                    <tr key={p.id}>
                      <td data-label="Mã kỳ"><strong>{p.code ?? legacyValue(p.id, "kỳ")}</strong></td>
                      <td data-label="Khoảng thời gian">{commissionPeriodDate(p.startDate)} – {commissionPeriodDate(p.endDate)}</td>
                      <td data-label="Tiền tệ">{p.currency ?? "—"}</td>
                      <td data-label="Tổng phải trả">{commissionPeriodTotal(p)}</td>
                      <td data-label="Trạng thái"><span className="pill">{commissionPeriodStatus(p.status)}</span></td>
                      <td data-label="Phiên bản">{p.version ?? "—"}</td>
                      <td data-label="Thao tác"><a href={`/admin/commission/periods/${p.id}`}>Xem chi tiết</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
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
        reason: "Thao tác từ màn hình kỳ hoa hồng",
      });
      await value.load();
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title="Chi tiết kỳ hoa hồng">
      <p><a href="/admin/commission/periods">← Quay lại danh sách kỳ</a></p>
      <States value={value} label="kỳ hoa hồng" />
      {message && <p role="alert">{message}</p>}
      {value.state === "ready" && (
        <>
          <div className="metric-grid" aria-label="Thông tin kỳ hoa hồng">
            <article className="metric-card"><span>Mã kỳ</span><strong>{value.data.code ?? legacyValue(value.data.id, "kỳ")}</strong><small>Định danh do máy chủ cấp</small></article>
            <article className="metric-card"><span>Trạng thái</span><strong>{commissionPeriodStatus(value.data.status)}</strong><small>Tuân theo state machine kỳ</small></article>
            <article className="metric-card"><span>Tiền tệ</span><strong>{value.data.currency ?? "—"}</strong><small>Không quy đổi chéo tiền tệ</small></article>
            <article className="metric-card"><span>Phiên bản</span><strong>{value.data.version ?? "—"}</strong><small>Dùng cho kiểm soát cạnh tranh</small></article>
          </div>
          <section className="state">
            <h2>Phạm vi kỳ và bằng chứng</h2>
            <dl className="summary-list">
              <div><dt>Bắt đầu từ</dt><dd>{commissionPeriodDate(value.data.startDate)}</dd></div>
              <div><dt>Kết thúc vào</dt><dd>{commissionPeriodDate(value.data.endDate)}</dd></div>
              <div><dt>Bắt đầu rà soát</dt><dd>{commissionRuleEffectiveDate(value.data.reviewStartedAt)}</dd></div>
              <div><dt>Khóa lúc</dt><dd>{commissionRuleEffectiveDate(value.data.lockedAt)}</dd></div>
              <div><dt>Tổng phải trả khi khóa</dt><dd>{commissionPeriodTotal(value.data)}</dd></div>
            </dl>
          </section>
          <div className="actions">
            {value.data.status === "OPEN" && <button onClick={() => void act("start-review")}>Bắt đầu rà soát</button>}
            {value.data.status === "REVIEW" && <button onClick={() => void act("reopen-review")}>Mở lại kỳ</button>}
            {value.data.status === "REVIEW" && <button onClick={() => void act("lock")}>Khóa bằng chứng</button>}
          </div>
          {Array.isArray(value.data.statements) && value.data.statements.length ? (
            <section>
              <h2>Snapshot theo nhân sự</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Nhân sự</th>
                      <th scope="col">Hoa hồng gốc</th>
                      <th scope="col">Hoàn/giảm</th>
                      <th scope="col">Điều chỉnh thủ công</th>
                      <th scope="col">Phải trả</th>
                      <th scope="col">Tiền tệ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.data.statements.map((statement: any) => (
                      <tr key={statement.id}>
                        <td data-label="Nhân sự"><strong>{statement.staffName ?? "Nhân sự đã ẩn"}</strong></td>
                        <td data-label="Hoa hồng gốc">{money(statement.earningMinor, statement.currency)}</td>
                        <td data-label="Hoàn/giảm">{money(statement.refundReversalMinor, statement.currency)}</td>
                        <td data-label="Điều chỉnh thủ công">{money(statement.manualAdjustmentMinor, statement.currency)}</td>
                        <td data-label="Phải trả"><strong>{money(statement.payableMinor, statement.currency)}</strong></td>
                        <td data-label="Tiền tệ">{statement.currency ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="state"><h2>Chưa có snapshot nhân sự</h2><p>Kỳ này chưa có bảng chốt nhân sự từ máy chủ.</p></div>
          )}
          <p className="hint">Bằng chứng kỳ hoa hồng được lưu theo workflow server. Không chỉnh sửa trực tiếp tổng tiền hoặc snapshot đã khóa.</p>
        </>
      )}
    </Shell>
  );
}
function Adjustments() {
  const value = useData("/v1/commission-adjustments"),
    [message, setMessage] = useState("");
  return (
    <Shell title="Điều chỉnh hoa hồng">
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
                  Phê duyệt
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
                  Từ chối
                </button>
              </div>
            )}
          </article>
        ))}
    </Shell>
  );
}

const financialExportTypes = [
  { type: "REFUNDS", label: "Báo cáo hoàn tiền", description: "Các khoản hoàn tiền và trạng thái xử lý theo bộ lọc máy chủ." },
  { type: "CREDIT_NOTES", label: "Báo cáo Credit Note", description: "Chứng từ Credit Note đã phát hành và quan hệ hoàn tiền." },
  { type: "COMMISSION_ENTRIES", label: "Bút toán hoa hồng", description: "Bằng chứng hoa hồng theo giao dịch đã ghi nhận." },
  { type: "COMMISSION_STATEMENTS", label: "Bảng chốt hoa hồng", description: "Snapshot phải trả theo kỳ và nhân sự." },
  { type: "NET_SALES", label: "Doanh thu thuần", description: "Doanh thu hóa đơn sau hoàn tiền đã hoàn tất." },
  { type: "PAYMENT_RECONCILIATION", label: "Đối soát thanh toán", description: "Tệp phục vụ đối soát giao dịch và phân bổ thanh toán." },
] as const;

function financialExportStatus(value: any) {
  const status = String(value ?? "UNKNOWN").toUpperCase();
  return {
    PENDING: "Đang chờ xử lý",
    PROCESSING: "Đang xử lý",
    READY: "Đã sẵn sàng",
    FAILED: "Thất bại",
    UNKNOWN: "Chưa xác định",
  }[status] ?? legacyText(status);
}

function financialExportType(value: any) {
  return financialExportTypes.find((item) => item.type === value)?.label ?? legacyText(String(value ?? "Loại chưa xác định"));
}

function financialExportDate(value: any) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";
}

function FinancialExports() {
  const [message, setMessage] = useState(""),
    [lastExport, setLastExport] = useState<any>(),
    [requesting, setRequesting] = useState<string>("");
  async function requestExport(exportType: string) {
    if (!navigator.onLine) {
      setMessage("Đang ngoại tuyến. Không thể tạo yêu cầu xuất báo cáo.");
      return;
    }
    setRequesting(exportType);
    setMessage("");
    try {
      const result = await command("/v1/financial/exports", { exportType, filters: {} });
      setLastExport(result);
      setMessage("Đã tạo yêu cầu. Worker sẽ cập nhật trạng thái theo job thật.");
    } catch (x: any) {
      setMessage(legacyText(x.message));
    } finally {
      setRequesting("");
    }
  }
  return (
    <Shell title="Xuất báo cáo tài chính">
      <div className="actions">
        <a href="/admin/financial/refunds">Báo cáo hoàn tiền</a>
        <a href="/admin/financial/net-sales">Doanh thu thuần</a>
        <a href="/admin/financial/commission">Hoa hồng</a>
      </div>
      <section className="state">
        <h2>Yêu cầu xuất từ dữ liệu máy chủ</h2>
        <p>Chọn đúng loại báo cáo. Hệ thống tạo job bất biến và worker chịu trách nhiệm xử lý; trình duyệt không tự tạo file.</p>
      </section>
      {message && <p role="status" className={lastExport ? "success" : "error"}>{message}</p>}
      {lastExport && (
        <section className="success">
          <strong>{financialExportType(lastExport.exportType)}</strong>
          <span> · {financialExportStatus(lastExport.status)}</span>
          <a href={`/admin/financial/exports/${lastExport.id}`}>Xem trạng thái yêu cầu</a>
        </section>
      )}
      <section className="export-catalog" aria-label="Các loại báo cáo có thể xuất">
        {financialExportTypes.map((item) => (
          <article className="export-card" key={item.type}>
            <span className="eyebrow">{item.type}</span>
            <h2>{item.label}</h2>
            <p>{item.description}</p>
            <button disabled={Boolean(requesting)} onClick={() => void requestExport(item.type)}>
              {requesting === item.type ? "Đang tạo yêu cầu…" : "Tạo yêu cầu xuất"}
            </button>
          </article>
        ))}
      </section>
      <p className="hint">Trạng thái và thời hạn tải xuống chỉ hiển thị từ financial_export_jobs. Quyền truy cập báo cáo do máy chủ kiểm soát.</p>
    </Shell>
  );
}

function FinancialExportDetail({ id }: { id: string }) {
  const value = useData(`/v1/financial/exports/${id}`);
  return (
    <Shell title="Trạng thái xuất báo cáo">
      <p><a href="/admin/financial/exports">← Quay lại danh sách loại báo cáo</a></p>
      <States value={value} label="yêu cầu xuất báo cáo" />
      {value.state === "ready" && (
        <>
          <div className="metric-grid" aria-label="Thông tin yêu cầu xuất">
            <article className="metric-card"><span>Loại báo cáo</span><strong>{financialExportType(value.data.exportType)}</strong><small>Do máy chủ ghi nhận</small></article>
            <article className="metric-card"><span>Trạng thái</span><strong>{financialExportStatus(value.data.status)}</strong><small>Không suy diễn ở trình duyệt</small></article>
            <article className="metric-card"><span>Tạo lúc</span><strong>{financialExportDate(value.data.createdAt)}</strong><small>Thời điểm job được ghi</small></article>
            <article className="metric-card"><span>Hết hạn</span><strong>{financialExportDate(value.data.expiresAt)}</strong><small>Theo thời hạn server</small></article>
          </div>
          <section className="state">
            <h2>Thông tin xử lý</h2>
            <dl className="summary-list">
              <div><dt>Phạm vi chi nhánh</dt><dd>{value.data.branchId ? "Theo chi nhánh đã chọn" : "Toàn salon"}</dd></div>
              <div><dt>Bộ lọc đã lưu</dt><dd>{value.data.filters && Object.keys(value.data.filters).length ? `${Object.keys(value.data.filters).length} điều kiện từ máy chủ` : "Không có bộ lọc"}</dd></div>
              <div><dt>File tải xuống</dt><dd>{value.data.downloadAvailable ? "Đã sẵn sàng theo job" : "Chưa sẵn sàng"}</dd></div>
            </dl>
          </section>
          <p className="hint">Màn hình này không tạo file cục bộ và không hiển thị dữ liệu ngoài response của job.</p>
        </>
      )}
    </Shell>
  );
}

function RefundReport() {
  const [filters, setFilters] = useState({ from: "", to: "" }),
    [applied, setApplied] = useState({ from: "", to: "" });
  const query = new URLSearchParams();
  if (applied.from) query.set("from", applied.from);
  if (applied.to) query.set("to", applied.to);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const value = useData(`/v1/financial/refunds${suffix}`),
    records = rows(value.data);
  return (
    <Shell title="Báo cáo hoàn tiền">
      <div className="actions">
        <a href="/admin/financial/exports">Xuất báo cáo</a>
        <a href="/admin/financial/net-sales">Đối chiếu doanh thu thuần</a>
        <a href="/admin/financial/commission">Mở báo cáo hoa hồng</a>
      </div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); setApplied(filters); }}>
        <label>
          Từ ngày
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <button type="submit">Áp dụng khoảng thời gian</button>
      </form>
      <States value={value} label="báo cáo hoàn tiền" />
      {value.state === "ready" && (
        <>
          <div className="metric-grid" aria-label="Tóm tắt báo cáo hoàn tiền">
            <article className="metric-card"><span>Bản ghi tổng hợp</span><strong>{records.length}</strong><small>Theo chi nhánh và tiền tệ</small></article>
            <article className="metric-card"><span>Khoảng thời gian</span><strong>{applied.from || applied.to ? "Đã lọc" : "Toàn bộ"}</strong><small>Điều kiện gửi tới máy chủ</small></article>
            <article className="metric-card"><span>Tiền tệ</span><strong>{new Set(records.map((row: any) => row.currency)).size || "—"}</strong><small>Không cộng chéo tiền tệ</small></article>
            <article className="metric-card"><span>Cập nhật</span><strong>{financialExportDate(value.data.generatedAt)}</strong><small>Thời điểm máy chủ tạo báo cáo</small></article>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Chi nhánh</th>
                  <th scope="col">Tiền tệ</th>
                  <th scope="col">Refund hoàn tất</th>
                  <th scope="col">Tổng đã hoàn</th>
                  <th scope="col">Hoàn dịch vụ</th>
                  <th scope="col">Thuế hoàn</th>
                  <th scope="col">Tip hoàn</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row: any) => (
                  <tr key={`${row.branch_id ?? "scope"}-${row.currency ?? "currency"}`}>
                    <td data-label="Chi nhánh">{row.branch_id ? "Chi nhánh trong phạm vi được cấp" : "Toàn phạm vi"}</td>
                    <td data-label="Tiền tệ">{row.currency ?? "—"}</td>
                    <td data-label="Refund hoàn tất">{row.completed_count ?? 0}</td>
                    <td data-label="Tổng đã hoàn"><strong>{money(row.refunded_minor, row.currency)}</strong></td>
                    <td data-label="Hoàn dịch vụ">{money(row.service_refund_minor, row.currency)}</td>
                    <td data-label="Thuế hoàn">{money(row.tax_refund_minor, row.currency)}</td>
                    <td data-label="Tip hoàn">{money(row.tip_refund_minor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Các số liệu trên là aggregate do API báo cáo trả về; màn hình không tự cộng lại từ dữ liệu hóa đơn trong trình duyệt.</p>
        </>
      )}
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
      setMessage("Đã tạo yêu cầu xuất báo cáo. Liên kết tải xuống có thời hạn.");
    } catch (x: any) {
      setMessage(x.message);
    }
  }
  return (
    <Shell title={`Tài chính · ${legacyText(title)}`}>
      <div className="actions">
        <a href="/admin/financial/refunds">Hoàn tiền</a>
        <a href="/admin/financial/net-sales">Doanh thu thuần</a>
        <a href="/admin/financial/commission">Hoa hồng</a>
        <button onClick={() => void exportReport()}>Xuất báo cáo</button>
      </div>
      {message && <p role="alert">{message}</p>}
      <States value={value} label={title} />
      {value.state === "ready" && (
        <LegacyDataTable rows={rows(value.data)} />
      )}
    </Shell>
  );
}
