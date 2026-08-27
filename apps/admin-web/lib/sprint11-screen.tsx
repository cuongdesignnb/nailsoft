/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { activeSession, authorizedFetch } from "./auth";
import { io } from "socket.io-client";
import { LegacyDataTable, legacyActionLabel, legacyColumnLabel } from "./legacy-workspace-ui";

type State = "loading" | "ready" | "empty" | "error" | "forbidden";
const routes: Record<
  string,
  { title: string; endpoint: string; create?: string; fields?: string[] }
> = {
  "/admin/communications/templates": {
    title: "Mẫu email",
    endpoint: "/v1/communications/templates",
    create: "/v1/communications/templates",
    fields: ["code", "category"],
  },
  "/admin/communications/rules": {
    title: "Quy tắc liên hệ",
    endpoint: "/v1/communications/rules",
    create: "/v1/communications/rules",
    fields: ["domainEvent", "purpose", "templateVersionId", "branchId"],
  },
  "/admin/communications/messages": {
    title: "Theo dõi gửi email",
    endpoint: "/v1/communications/messages",
  },
  "/admin/communications/suppressions": {
    title: "Danh sách chặn liên hệ",
    endpoint: "/v1/communications/messages",
  },
  "/admin/marketing/segments": {
    title: "Nhóm khách hàng",
    endpoint: "/v1/customer-segments",
    create: "/v1/customer-segments",
    fields: ["name", "branchId", "locale"],
  },
  "/admin/marketing/campaigns": {
    title: "Chiến dịch email",
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
  "/admin/reviews": { title: "Đánh giá khách hàng", endpoint: "/v1/reviews" },
  "/admin/review-requests": {
    title: "Yêu cầu đánh giá",
    endpoint: "/v1/review-requests",
  },
  "/admin/service-recovery": {
    title: "Xử lý phục hồi dịch vụ",
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

export function campaignActions(status: string): string[] {
  return (
    {
      DRAFT: ["submit", "cancel"],
      PENDING_APPROVAL: ["approve", "cancel"],
      APPROVED: ["schedule", "cancel"],
      SCHEDULED: ["cancel"],
      RUNNING: ["pause", "cancel"],
      PAUSED: ["resume", "cancel"],
    } as Record<string, string[]>
  )[status] ?? [];
}

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if ([401, 403].includes(response.status))
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok) {
    const code = String(body.error?.code ?? "REQUEST_FAILED");
    const messages: Record<string, string> = {
      COMMUNICATION_MESSAGE_NOT_FOUND: "Không tìm thấy thông điệp trong phạm vi được cấp quyền.",
      MESSAGE_RETRY_NOT_ALLOWED: "Email này chưa ở trạng thái được phép thử lại.",
      VERSION_CONFLICT: "Dữ liệu vừa thay đổi. Hãy tải lại trước khi tiếp tục.",
      REQUEST_FAILED: "Không thể hoàn tất yêu cầu. Vui lòng thử lại.",
    };
    throw Object.assign(
      new Error(messages[code] ?? "Không thể hoàn tất yêu cầu. Vui lòng thử lại."),
      { code },
    );
  }
  return body.data;
}
async function command(path: string, body: unknown, idempotencyKey = crypto.randomUUID()) {
  if (!navigator.onLine)
    throw new Error(
      "Internet connection required. Engagement writes are not queued offline.",
    );
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

export default function Sprint11Screen({ pathname }: { pathname: string }) {
  const detailMessage = pathname.match(
    /^\/admin\/communications\/messages\/([^/]+)$/,
  );
  if (detailMessage)
    return <MessageDetail messageId={detailMessage[1] ?? ""} />;
  const detailCampaign = pathname.match(
    /^\/admin\/marketing\/campaigns\/([^/]+)$/,
  );
  if (detailCampaign)
    return (
      <Detail
        title="Chi tiết chiến dịch"
        endpoint={`/v1/marketing-campaigns/${detailCampaign[1]}`}
        actions={["submit", "approve", "schedule", "pause", "resume", "cancel"]}
      />
    );
  const detailReview = pathname.match(/^\/admin\/reviews\/([^/]+)$/);
  if (detailReview)
    return (
      <Detail
        title="Chi tiết đánh giá"
        endpoint={`/v1/reviews/${detailReview[1]}`}
        actions={["publish", "hide", "flag", "respond"]}
      />
    );
  const detailRecovery = pathname.match(/^\/admin\/service-recovery\/([^/]+)$/);
  if (detailRecovery)
    return (
      <Detail
        title="Hồ sơ phục hồi dịch vụ"
        endpoint={`/v1/service-recovery/cases/${detailRecovery[1]}`}
        actions={["triage", "start", "wait-customer", "resolve", "close"]}
      />
    );
  const customer = pathname.match(/^\/admin\/customers\/([^/]+)\/engagement$/);
  if (customer)
    return (
      <Detail
        title="Lịch sử liên hệ khách hàng"
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

function messageDate(value: unknown) {
  if (!value) return "Chưa ghi nhận";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Chưa ghi nhận";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function messagePurpose(value: unknown) {
  const key = String(value ?? "").toUpperCase();
  const labels: Record<string, string> = {
    APPOINTMENT_CONFIRMATION: "Xác nhận lịch hẹn",
    APPOINTMENT_REMINDER: "Nhắc lịch hẹn",
    REVIEW_REQUEST: "Mời đánh giá",
    MARKETING: "Marketing",
    SERVICE_RECOVERY: "Phục hồi dịch vụ",
  };
  return labels[key] ?? (key ? key.replaceAll("_", " ") : "Email giao dịch");
}

function messageStatus(value: unknown) {
  const key = String(value ?? "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    PENDING: "Đang chờ",
    SCHEDULED: "Đã lên lịch",
    PROCESSING: "Đang gửi",
    SENT: "Đã gửi",
    FAILED: "Thất bại",
    DEAD_LETTER: "Không thể gửi",
    SUPPRESSED: "Đã chặn gửi",
    CANCELLED: "Đã hủy",
  };
  return labels[key] ?? "Chưa xác định";
}

function MessageDetail({ messageId }: { messageId: string }) {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<any>();
  const [attempts, setAttempts] = useState<any[]>([]);
  const [attemptError, setAttemptError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const retryIntent = useRef("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    setAttemptError("");
    try {
      const value = await api(`/v1/communications/messages/${messageId}`);
      setMessage(value);
      setState("ready");
      try {
        const rows = await api(`/v1/communications/messages/${messageId}/attempts`);
        setAttempts(Array.isArray(rows) ? rows : []);
      } catch (cause: any) {
        setAttempts([]);
        setAttemptError(cause?.message ?? "Không thể tải lịch sử lần gửi.");
      }
    } catch (cause: any) {
      setState(cause?.forbidden ? "forbidden" : "error");
      setError(cause?.message ?? "Không thể tải email.");
    }
  }, [messageId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry() {
    const status = String(message?.status ?? "").toUpperCase();
    if (!message || !["FAILED", "DEAD_LETTER"].includes(status)) return;
    setBusy(true);
    setNotice("");
    try {
      retryIntent.current ||= crypto.randomUUID();
      await command(
        `/v1/communications/messages/${messageId}/retry`,
        { version: message.version },
        retryIntent.current,
      );
      retryIntent.current = "";
      setNotice("Đã gửi yêu cầu thử lại. Trạng thái sẽ được cập nhật từ máy chủ.");
      await load();
    } catch (cause: any) {
      setNotice(cause?.message ?? "Không thể thử lại email.");
    } finally {
      setBusy(false);
    }
  }

  const status = String(message?.status ?? "").toUpperCase();
  const canRetry = status === "FAILED" || status === "DEAD_LETTER";
  const customerId = message?.customerId ?? message?.customer_id;
  const category = message?.category ?? "Email";
  const purpose = messagePurpose(message?.purpose);
  return (
    <Shell title="Chi tiết email">
      {state === "loading" && <div className="skeleton">Đang tải thông tin email…</div>}
      {state === "forbidden" && (
        <div className="state" role="alert">
          <h2>Không có quyền truy cập</h2>
          <p>Quyền đọc thông điệp hoặc phạm vi chi nhánh hiện tại không cho phép xem email này.</p>
          <button onClick={() => void load()}>Thử lại</button>
        </div>
      )}
      {state === "error" && (
        <div className="state" role="alert">
          <h2>Không thể tải email</h2>
          <p>{error}</p>
          <button onClick={() => void load()}>Thử lại</button>
        </div>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
      {state === "ready" && message && (
        <div className="engagement-message-detail">
          <header className="engagement-message-header">
            <div>
              <p className="eyebrow">GIAO TIẾP · EMAIL</p>
              <h2>{purpose}</h2>
              <p className="hint">{category} · dữ liệu gửi được lấy từ hệ thống giao tiếp.</p>
            </div>
            <div className="engagement-message-actions">
              <span className={`engagement-message-status is-${status.toLowerCase()}`}>{messageStatus(status)}</span>
              {canRetry && <button disabled={busy} onClick={() => void retry()}>{busy ? "Đang gửi yêu cầu…" : "Thử gửi lại"}</button>}
              {customerId && <a href={`/admin/customers/${encodeURIComponent(customerId)}`}>Mở hồ sơ khách hàng</a>}
            </div>
          </header>
          <div className="engagement-message-kpis" aria-label="Tóm tắt email">
            <article><span>Trạng thái</span><strong>{messageStatus(status)}</strong></article>
            <article><span>Số lần gửi</span><strong>{message.attemptCount ?? message.attempt_count ?? attempts.length}</strong></article>
            <article><span>Ngày tạo</span><strong>{messageDate(message.createdAt ?? message.created_at)}</strong></article>
            <article><span>Ngày gửi</span><strong>{messageDate(message.sentAt ?? message.sent_at)}</strong></article>
          </div>
          <div className="engagement-message-grid">
            <section className="engagement-message-card">
              <p className="eyebrow">THÔNG TIN GỬI</p>
              <h3>Ngữ cảnh thông điệp</h3>
              <dl>
                <div><dt>Kênh</dt><dd>{String(message.channel ?? "EMAIL").toUpperCase() === "EMAIL" ? "Email" : message.channel}</dd></div>
                <div><dt>Mục đích</dt><dd>{purpose}</dd></div>
                <div><dt>Lên lịch</dt><dd>{messageDate(message.scheduledAt ?? message.scheduled_at)}</dd></div>
                <div><dt>Cập nhật</dt><dd>{messageDate(message.updatedAt ?? message.updated_at)}</dd></div>
                {message.safeErrorCode ?? message.safe_error_code ? <div><dt>Mã lỗi an toàn</dt><dd>{message.safeErrorCode ?? message.safe_error_code}</dd></div> : null}
                {message.suppressionReason ?? message.suppression_reason ? <div><dt>Lý do chặn</dt><dd>{message.suppressionReason ?? message.suppression_reason}</dd></div> : null}
              </dl>
            </section>
            <section className="engagement-message-card">
              <div className="engagement-message-card-heading"><div><p className="eyebrow">DELIVERY ATTEMPTS</p><h3>Lịch sử lần gửi</h3></div><span>{attempts.length} lần</span></div>
              {attemptError && <p className="engagement-message-inline-error">{attemptError}</p>}
              {!attemptError && !attempts.length && <p className="engagement-message-empty">Chưa có lần gửi được lưu.</p>}
              {attempts.length > 0 && <ol className="engagement-message-timeline">{attempts.map((attempt: any, index) => <li key={`${attempt.attemptNumber ?? attempt.attempt_number ?? index}`}><div className="engagement-message-timeline-dot" aria-hidden="true" /><div><strong>Lần {attempt.attemptNumber ?? attempt.attempt_number ?? index + 1} · {messageStatus(attempt.result)}</strong><p>{messageDate(attempt.createdAt ?? attempt.created_at)}{attempt.safeErrorCode ?? attempt.safe_error_code ? ` · ${attempt.safeErrorCode ?? attempt.safe_error_code}` : ""}</p>{attempt.retryAfter ?? attempt.retry_after ? <small>Thử lại sau: {messageDate(attempt.retryAfter ?? attempt.retry_after)}</small> : null}</div></li>)}</ol>}
            </section>
          </div>
          <aside className="engagement-message-notice"><strong>Thông tin an toàn</strong><p>Chỉ hiển thị trạng thái và lỗi đã được máy chủ làm sạch. Không hiển thị nội dung provider, credential, token hoặc header nhạy cảm.</p></aside>
        </div>
      )}
    </Shell>
  );
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
      <div className="skeleton">Đang tải dữ liệu liên hệ từ máy chủ…</div>
    );
  if (resource.state === "forbidden")
    return (
      <div className="state">
        <h2>Không có quyền truy cập</h2>
        <p>Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này.</p>
      </div>
    );
  if (resource.state === "empty")
    return (
      <div className="state">
        <h2>Chưa có dữ liệu</h2>
        <p>Chưa có bản ghi phù hợp trong phạm vi hiện tại.</p>
        <button onClick={() => void resource.load()}>Làm mới</button>
      </div>
    );
  return (
    <div className="state">
      <h2>Không thể tải dữ liệu</h2>
      <p>{resource.error}</p>
      <button onClick={() => void resource.load()}>Thử lại</button>
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
            {routes[href]?.title ?? "Khu vực quản trị"}
          </a>
        ))}
      </nav>
      <section className="card">
        <p className="eyebrow">KHÁCH HÀNG · LIÊN HỆ & CHĂM SÓC</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Chỉ gửi Email · kiểm tra consent trước khi gửi · dữ liệu có audit
            </p>
          </div>
          <span className="timezone">Chỉ hỗ trợ Email</span>
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
      if (config.endpoint === "/v1/customer-segments")
        body = {
          name: values.name,
          branchId: values.branchId || null,
          filters: {
            locale: values.locale || undefined,
            marketingConsent: true,
          },
        };
      if (config.endpoint === "/v1/marketing-campaigns")
        body = {
          ...values,
          branchId: values.branchId || null,
          riskLevel: "STANDARD",
        };
      if (config.endpoint === "/v1/service-recovery/cases")
        body = {
          ...values,
          source: values.source || "MANUAL",
          severity: values.severity || "MEDIUM",
        };
      await command(config.create, body);
      setNotice("Đã lưu thành công.");
      setValues({});
      await resource.load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Thao tác chưa hoàn tất.");
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
              {legacyColumnLabel(field)}
              <input
                required={!["branchId", "locale"].includes(field)}
                value={values[field] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [field]: e.target.value })
                }
              />
            </label>
          ))}
          <button disabled={busy}>{busy ? "Đang lưu…" : "Tạo mới"}</button>
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
  return <LegacyDataTable rows={rows} excludeKeys={["proposal_json", "filter_json", "variables_json", "rendered_html", "rendered_text"]} />;
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
  const visibleActions =
    title === "Chi tiết chiến dịch"
      ? campaignActions(resource.rows[0]?.status)
      : actions;
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
      setNotice(`Đã thực hiện: ${legacyActionLabel(action)}.`);
      await resource.load();
    } catch (e) {
        setNotice(e instanceof Error ? e.message : "Thao tác chưa hoàn tất.");
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
            {visibleActions.map((a) => (
              <button key={a} onClick={() => void run(a)}>
                {legacyActionLabel(a)}
              </button>
            ))}
          </div>
          <LegacyDataTable rows={[resource.rows[0]]} excludeKeys={["proposal_json", "filter_json", "variables_json", "rendered_html", "rendered_text"]} />
          <small>Mã bản ghi: {id ? "Mã hệ thống" : "—"}</small>
        </>
      )}
    </Shell>
  );
}
