/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "../auth";
import styles from "./cash-session-closing-page.module.css";

type SessionStatus = "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
type Money = number | null;
type Session = {
  id: string;
  branchId: string;
  registerId: string;
  registerCode: string;
  drawerCode: string;
  cashierUserId: string;
  currency: string;
  status: SessionStatus;
  blindCount: boolean;
  openedAt: string;
  closingStartedAt?: string | null;
  closedAt?: string | null;
  openingFloatMinor: Money;
  expectedCashMinor: Money;
  declaredCashMinor: Money;
  varianceMinor: Money;
  varianceThresholdMinor: Money;
  varianceReason?: string | null;
  varianceApprovedByUserId?: string | null;
  version: number;
};
type Movement = {
  id: string;
  movementType: string;
  direction: string;
  amountMinor: Money;
  currency: string;
  reasonCode?: string | null;
  occurredAt?: string | null;
};
type Attention = {
  code: string;
  severity: "BLOCKING" | "WARNING";
  blocking: boolean;
  message: string;
  orderId?: string | null;
  paymentId?: string | null;
  amountMinor: Money;
};
type Overview = {
  session: Session;
  register: { id: string; code: string; name: string; branchId: string; branchName: string };
  cashier: { id: string; displayName: string };
  metrics: {
    paidOrderCount: number;
    capturedOrderCount: number;
    sessionSalesMinor: Money;
    totalCapturedMinor: Money;
    cashCapturedMinor: Money;
    partialOrderCount: number;
    paymentMix: Record<string, { amountMinor: Money; paymentCount: number }> | null;
  };
  cashFlow: {
    openingFloatMinor: Money;
    cashSalesMinor: Money;
    cashInMinor: Money;
    cashOutMinor: Money;
    cashDropMinor: Money;
    cashRefundMinor: Money;
    expectedCashMinor: Money;
  };
  movements: Movement[];
  refunds: Array<{ id: string; refundReference?: string | null; amountMinor: Money; occurredAt?: string | null; reasonCode?: string | null }>;
  attention: Attention[];
  closingReadiness: { canBeginClosing: boolean; blockers: Attention[]; warnings: Attention[] };
  transactions: { items: Array<{ orderId: string; orderNumber?: string | null; status: string; totalMinor: Money; capturedMinor: Money; customerDisplayName?: string | null }>; pagination: { total: number } };
  generatedAt: string;
};
type ClosingReview = Session & { movements: Movement[] };
type ApiBody<T> = { data?: T; error?: { message?: string; code?: string } };
type Denomination = { denominationMinor: number; count: number };

const vndDenominations = [500000, 200000, 100000, 50000, 20000, 10000];
const statusLabels: Record<SessionStatus, string> = {
  OPEN: "Chuẩn bị đóng",
  CLOSING: "Đang đối soát",
  CLOSED: "Đã đóng",
  CANCELLED: "Đã hủy",
};
const attentionLabels: Record<string, string> = {
  PENDING_PAYMENT: "Thanh toán đang xử lý",
  PARTIAL_ORDER: "Thanh toán một phần",
  FAILED_PAYMENT: "Thanh toán lỗi",
  UNISSUED_INVOICE: "Chưa phát hành hóa đơn",
};
const varianceReasons = [
  "Sai lệch kiểm đếm",
  "Tiền thừa / thiếu",
  "Chi tiền chưa ghi nhận",
  "Hoàn tiền cần kiểm tra",
  "Khác",
];

function money(value: Money, currency = "VND") {
  if (value == null) return "—";
  const zeroDecimal = ["VND", "JPY", "KRW"].includes(currency);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  }).format(zeroDecimal ? value : value / 100);
}

function dateTime(value: string | null | undefined, timezone = "Asia/Ho_Chi_Minh") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function timeOnly(value: string | null | undefined, timezone = "Asia/Ho_Chi_Minh") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function duration(openedAt: string, status: SessionStatus, closedAt?: string | null) {
  const end = status === "CLOSED" && closedAt ? new Date(closedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.floor((end - new Date(openedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} giờ ${minutes % 60} phút` : `${minutes} phút`;
}

function unwrap<T>(body: ApiBody<T>) {
  if (!body.data) throw new Error("API không trả về dữ liệu phiên thu ngân.");
  return body.data;
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = (await response.json().catch(() => ({}))) as ApiBody<T>;
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Không thể hoàn tất thao tác đóng phiên."), {
      code: body.error?.code,
      status: response.status,
    });
  }
  return unwrap(body);
}

function apiError(reason: any) {
  if (reason?.code === "CASH_SESSION_STATUS_INVALID") return "Phiên đang có giao dịch thanh toán chưa hoàn tất. Vui lòng xử lý giao dịch trước khi đóng phiên.";
  if (reason?.code === "CASH_SESSION_COUNT_MISMATCH") return "Tổng theo mệnh giá không khớp số tiền thực tế đã khai báo.";
  if (reason?.code === "CASH_SESSION_VARIANCE_APPROVAL_REQUIRED") return "Chênh lệch vượt ngưỡng. Cần quản lý phê duyệt và ghi rõ lý do trước khi đóng phiên.";
  if (reason?.code === "FINANCIAL_PERMISSION_DENIED") return "Tài khoản hiện tại không có quyền phê duyệt chênh lệch lớn của phiên này.";
  if (reason?.code === "VERSION_CONFLICT") return "Dữ liệu phiên vừa thay đổi. Màn hình đã được tải lại, hãy kiểm tra lại trước khi tiếp tục.";
  if (reason?.code === "POS_REGISTER_DEVICE_NOT_BOUND" || reason?.code === "POS_REGISTER_DEVICE_SESSION_INVALID") return "Thiết bị hiện tại chưa được xác thực với quầy thu ngân.";
  return reason?.message ?? "Không thể hoàn tất thao tác đóng phiên.";
}

function statusClass(status: SessionStatus) {
  return status === "CLOSED" ? styles.statusClosed : status === "CLOSING" ? styles.statusClosing : status === "CANCELLED" ? styles.statusCancelled : styles.statusOpen;
}

function Icon({ children }: { children: string }) {
  return <span className={styles.icon} aria-hidden="true">{children}</span>;
}

function StatusPill({ status }: { status: SessionStatus }) {
  return <span className={`${styles.statusPill} ${statusClass(status)}`}><i />{statusLabels[status]}</span>;
}

function Stepper({ status, declared }: { status: SessionStatus; declared: boolean }) {
  const current = status === "OPEN" ? 1 : status === "CLOSING" && !declared ? 2 : status === "CLOSING" ? 3 : 5;
  const steps = ["Kiểm tra giao dịch", "Kiểm đếm tiền", "Đối soát chênh lệch", "Xác nhận", "Đóng phiên"];
  return <ol className={styles.stepper} aria-label="Tiến trình đóng phiên">
    {steps.map((step, index) => {
      const number = index + 1;
      const complete = number < current || status === "CLOSED";
      return <li className={complete ? styles.stepComplete : number === current ? styles.stepCurrent : styles.stepPending} key={step}>
        <span>{complete ? "✓" : number}</span><strong>{step}</strong>
      </li>;
    })}
  </ol>;
}

function LoadingState() {
  return <main className={styles.page} aria-busy="true">
    <div className={styles.loadingHeader}><div /><div /></div>
    <div className={styles.loadingHero} />
    <div className={styles.loadingGrid}><div /><div /><div /></div>
  </main>;
}

export default function CashSessionClosingPage({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [review, setReview] = useState<ClosingReview | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [declaredDraft, setDeclaredDraft] = useState("");
  const [denominations, setDenominations] = useState<Denomination[]>(() => vndDenominations.map((denominationMinor) => ({ denominationMinor, count: 0 })));
  const [, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonType, setReasonType] = useState(varianceReasons[0]);
  const [reasonDetail, setReasonDetail] = useState("");
  const [varianceApproved, setVarianceApproved] = useState(false);
  const [result, setResult] = useState<Session | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const intentKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    setOnline(navigator.onLine);
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const overview = await requestJson<Overview>(`/v1/cash-sessions/${encodeURIComponent(sessionId)}/overview?page=1&pageSize=10`);
      if (versionRef.current != null && versionRef.current !== overview.session.version && dirtyRef.current) setStale(true);
      versionRef.current = overview.session.version;
      setData(overview);
      if (!dirtyRef.current) {
        setDeclaredDraft(overview.session.declaredCashMinor == null ? "" : String(overview.session.declaredCashMinor));
      }
      try {
        const full = await requestJson<ClosingReview>(`/v1/cash-sessions/${encodeURIComponent(sessionId)}/closing-review`);
        setReview(full);
        setReviewError("");
      } catch (reason: any) {
        if (reason?.status === 401 || reason?.status === 403 || reason?.code === "FINANCIAL_PERMISSION_DENIED") {
          setReview(null);
          setReviewError("");
        } else {
          setReviewError(apiError(reason));
        }
      }
      setError("");
    } catch (reason: any) {
      setError(apiError(reason));
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const session = result ?? data?.session;
  const revealed = Boolean(review && !review.blindCount);
  const currency = session?.currency ?? data?.session.currency ?? "VND";
  const denomTotal = useMemo(() => denominations.reduce((total, row) => total + row.denominationMinor * row.count, 0), [denominations]);
  const declaredNumber = declaredDraft === "" ? null : Number(declaredDraft);
  const hasDenominations = currency === "VND";
  const declaredMismatch = hasDenominations && declaredNumber != null && denomTotal !== declaredNumber;
  const reviewSession = review && review.status === "CLOSED" ? review : review;
  const expected = revealed ? reviewSession?.expectedCashMinor ?? null : null;
  const variance = revealed ? reviewSession?.varianceMinor ?? null : null;
  const threshold = revealed ? reviewSession?.varianceThresholdMinor ?? null : null;
  const highVariance = variance != null && threshold != null && Math.abs(variance) > threshold;
  const blockers = data?.closingReadiness.blockers ?? [];
  const finalReason = `${reasonType}${reasonDetail.trim() ? `: ${reasonDetail.trim()}` : ""}`;
  const canWrite = online && !saving && !stale;
  const canDeclare = canWrite && session?.status === "CLOSING" && declaredNumber != null && Number.isSafeInteger(declaredNumber) && declaredNumber >= 0 && !declaredMismatch;
  const canClose = canWrite && session?.status === "CLOSING" && session.declaredCashMinor != null && (!highVariance || (revealed && varianceApproved && reasonDetail.trim().length >= 3));
  const detailHref = `/admin/pos/cash-sessions/${encodeURIComponent(sessionId)}`;

  function keyFor(command: string) {
    const current = intentKeys.current[command];
    if (current) return current;
    const next = window.crypto.randomUUID();
    intentKeys.current[command] = next;
    return next;
  }

  function clearKey(command: string) {
    delete intentKeys.current[command];
  }

  async function command(command: "begin" | "declare" | "close", path: string, body: Record<string, unknown>, success: string) {
    if (!session || !canWrite) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await requestJson<Session>(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": keyFor(command) },
        body: JSON.stringify(body),
      });
      clearKey(command);
      setNotice(success);
      setStale(false);
      dirtyRef.current = false;
      setDirty(false);
      if (next.status === "CLOSED") {
        setResult(next);
        setConfirmOpen(false);
      }
      await load(true);
    } catch (reason: any) {
      setError(apiError(reason));
      if (reason?.code === "VERSION_CONFLICT" || reason?.code === "CASH_SESSION_STATUS_INVALID") await load(true);
    } finally {
      setSaving(false);
    }
  }

  async function beginClosing() {
    if (!data || blockers.length > 0) return;
    await command("begin", `/v1/cash-sessions/${encodeURIComponent(sessionId)}/begin-closing`, { version: data.session.version }, "Phiên đã chuyển sang trạng thái đối soát. Hãy kiểm đếm tiền mặt thực tế.");
  }

  async function declare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canDeclare || declaredNumber == null) return;
    const body: Record<string, unknown> = { version: data.session.version, declaredCashMinor: declaredNumber };
    if (hasDenominations) body.denominations = denominations.filter((row) => row.count > 0);
    await command("declare", `/v1/cash-sessions/${encodeURIComponent(sessionId)}/declare`, body, "Đã lưu kiểm đếm. Số liệu đối soát đã được cập nhật từ server.");
  }

  async function closeSession() {
    if (!data || !canClose) return;
    const body: Record<string, unknown> = { version: data.session.version, approveVariance: highVariance ? varianceApproved : false };
    if (highVariance || reasonDetail.trim()) body.varianceReason = finalReason;
    await command("close", `/v1/cash-sessions/${encodeURIComponent(sessionId)}/close`, body, "Đã đóng phiên thu ngân thành công.");
  }

  function updateDeclared(value: string) {
    if (!/^\d*$/.test(value)) return;
    setDeclaredDraft(value);
    dirtyRef.current = true;
    setDirty(true);
    setStale(false);
  }

  function updateDenomination(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const count = value === "" ? 0 : Number(value);
    setDenominations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, count } : row));
    dirtyRef.current = true;
    setDirty(true);
    setStale(false);
  }

  function recount() {
    setDeclaredDraft("");
    setDenominations(vndDenominations.map((denominationMinor) => ({ denominationMinor, count: 0 })));
    dirtyRef.current = true;
    setDirty(true);
    setStale(false);
    setNotice("Đã xóa số kiểm đếm nháp trên màn hình. Chưa có dữ liệu mới được gửi lên server.");
  }

  if (loading && !data) return <LoadingState />;
  if (!data || !session) return <main className={styles.page}><div className={styles.errorCard} role="alert"><strong>Không thể tải màn đóng phiên</strong><p>{error || "Phiên thu ngân không tồn tại hoặc bạn không có quyền xem."}</p><button type="button" onClick={() => void load()}>Thử lại</button></div></main>;

  const closed = session.status === "CLOSED";
  const open = session.status === "OPEN";
  const closing = session.status === "CLOSING";
  const titleStatus = closed ? "Đã đóng" : statusLabels[session.status];
  const attention = [...(data.attention ?? [])].sort((left, right) => Number(right.blocking) - Number(left.blocking));

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.breadcrumb}><a href="/admin/pos/registers">POS</a><b>/</b><a href="/admin/pos/registers">Quầy thu ngân</a><b>/</b><span>{session.registerCode}</span><b>/</b> Đóng phiên</p>
        <div className={styles.titleLine}><h1>Đóng phiên thu ngân</h1><span className={`${styles.statusPill} ${statusClass(session.status)}`}><i />{titleStatus}</span></div>
        <p className={styles.subtitle}>Kiểm đếm tiền thực tế, đối soát giao dịch và xác nhận chênh lệch trước khi đóng phiên.</p>
      </div>
      <div className={styles.headerActions}><a className={styles.secondaryButton} href={detailHref}>← &nbsp;Quay lại chi tiết phiên</a>{closed ? <a className={styles.primaryButton} href={detailHref}>Xem phiên đã đóng</a> : <button className={styles.secondaryButton} type="button" onClick={() => window.print()}>▣ &nbsp;In báo cáo tạm tính</button>}</div>
    </header>

    {!online && <div className={styles.offlineBanner} role="alert"><Icon>!</Icon><div><strong>Cần kết nối Internet để đối soát và đóng phiên.</strong><span>Các thao tác bắt đầu, khai báo và đóng phiên đang bị vô hiệu hóa.</span></div></div>}
    {error && <div className={styles.errorBanner} role="alert"><Icon>!</Icon><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>}
    {notice && <div className={styles.successBanner} role="status"><Icon>✓</Icon><span>{notice}</span></div>}
    {stale && <div className={styles.warningBanner} role="alert"><Icon>!</Icon><div><strong>Dữ liệu phiên vừa thay đổi.</strong><span>Bản kiểm đếm đang nhập được giữ nguyên. Hãy kiểm tra lại phiên rồi khai báo bằng version mới.</span></div><button type="button" onClick={() => void load()}>Tải lại</button></div>}

    <section className={styles.safetyBanner}><Icon>⚠</Icon><div><strong>{closed ? "Phiên đã được đóng và không còn nhận thanh toán tiền mặt." : open && blockers.length ? "Hãy xử lý các giao dịch còn đang được xử lý trước khi bắt đầu đóng phiên." : "Hãy kiểm tra số tiền thực tế và xử lý các ngoại lệ trước khi xác nhận."}</strong><span>{closed ? "Số liệu đối soát của phiên được lưu vào lịch sử tài chính." : "Sau khi đóng phiên, quầy không còn phiên thu ngân đang mở và cần mở phiên mới cho lần thu tiền tiếp theo."}</span></div></section>

    <section className={styles.sessionHero} aria-labelledby="closing-session-title">
      <div className={styles.heroIdentity}><div className={styles.heroIcon}>▣</div><div><p className={styles.eyebrow}>PHIÊN THU NGÂN</p><h2 id="closing-session-title">#{session.id.slice(0, 8).toUpperCase()}</h2><p>{data.register.name} · {session.registerCode}</p><StatusPill status={session.status} /></div></div>
      <dl className={styles.heroStats}><div><dt>Quầy</dt><dd>{data.register.name}</dd></div><div><dt>Thu ngân</dt><dd>{data.cashier.displayName}</dd></div><div><dt>Chi nhánh</dt><dd>{data.register.branchName}</dd></div><div><dt>Mở lúc</dt><dd>{dateTime(session.openedAt)}</dd></div><div><dt>Thời gian hoạt động</dt><dd>{duration(session.openedAt, session.status, session.closedAt)}</dd></div></dl>
      <div className={styles.heroAmount}><span>Tiền mặt dự kiến</span><strong>{revealed ? money(expected, currency) : "Được ẩn"}</strong><small>{revealed ? "Theo dữ liệu server" : "Blind count đang bật"}</small></div>
    </section>

    <Stepper status={session.status} declared={session.declaredCashMinor != null} />

    {closed && <section className={styles.closedResult} role="status"><div className={styles.resultIcon}>✓</div><div><p className={styles.eyebrow}>CLOSED</p><h2>Đã đóng phiên thành công</h2><p>Phiên đã được khóa theo đúng workflow. Không còn giao dịch tiền mặt mới được gắn vào phiên này.</p></div><dl><div><dt>Đã khai báo</dt><dd>{money(session.declaredCashMinor, currency)}</dd></div><div><dt>Chênh lệch</dt><dd>{revealed ? money(variance, currency) : "Được ẩn"}</dd></div><div><dt>Đóng lúc</dt><dd>{dateTime(session.closedAt)}</dd></div></dl></section>}

    <div className={styles.workspace}>
      <div className={styles.mainColumn}>
        {open && <section className={styles.card}><CardHeader eyebrow="1. KIỂM TRA GIAO DỊCH" title="Kiểm tra trước khi bắt đầu kiểm đếm" detail="Backend sẽ kiểm tra lại các điều kiện này khi bạn bấm bắt đầu." /><div className={styles.checkList}>{[
          ["Quầy đang trực tuyến", true],
          ["Thiết bị và quyền truy cập quầy hợp lệ", true],
          ["Không có thanh toán PENDING / AUTHORIZED", blockers.length === 0],
          ["Giao dịch PARTIALLY_PAID chỉ là cảnh báo", true],
        ].map(([label, pass]) => <div className={pass ? styles.checkPass : styles.checkBlock} key={String(label)}><span>{pass ? "✓" : "!"}</span><strong>{label}</strong><small>{pass ? "Đã kiểm tra" : "Cần xử lý trước khi đóng"}</small></div>)}</div>{attention.length > 0 && <AttentionList items={attention} currency={currency} />}</section>}

        {closing && <>
          <section className={styles.card}><CardHeader eyebrow="2. KIỂM ĐẾM TIỀN MẶT CUỐI CA" title="Kiểm đếm tiền mặt cuối ca" detail={hasDenominations ? "Nhập số tiền thực tế và kiểm lại theo từng mệnh giá. Backend sẽ xác thực tổng mệnh giá." : "Nhập số tiền theo đơn vị nhỏ nhất của loại tiền phiên đang sử dụng."} /><div className={styles.countLayout}><div className={styles.actualPanel}><label htmlFor="declared-cash">Số tiền thực tế trong ngăn kéo</label><div className={styles.moneyInput}><input id="declared-cash" inputMode="numeric" value={declaredDraft} onChange={(event) => updateDeclared(event.target.value)} placeholder="0" aria-describedby="cash-input-help" /><span>{currency}</span></div><small id="cash-input-help">Số nguyên theo đơn vị nhỏ nhất của {currency}. Không dùng số thập phân.</small>{revealed ? <div className={styles.expectedHint}><span>Tiền mặt hệ thống dự kiến</span><strong>{money(expected, currency)}</strong></div> : <div className={styles.blindHint}><Icon>◉</Icon><span>Tiền mặt hệ thống dự kiến được ẩn theo chính sách blind count.</span></div>}{declaredNumber != null && <div className={declaredNumber >= 0 ? styles.countPreview : styles.countPreviewError}><span>Đã nhập</span><strong>{money(declaredNumber, currency)}</strong></div>}</div>{hasDenominations && <div className={styles.denominationPanel}><div className={styles.subheading}><strong>Kiểm đếm theo mệnh giá</strong><span>Tổng: <b>{money(denomTotal, currency)}</b></span></div><table className={styles.denomTable}><thead><tr><th scope="col">Mệnh giá</th><th scope="col">Số tờ / tiền</th><th scope="col">Thành tiền</th></tr></thead><tbody>{denominations.map((row, index) => <tr key={row.denominationMinor}><th scope="row">{money(row.denominationMinor, currency)}</th><td><input aria-label={`Số lượng mệnh giá ${row.denominationMinor}`} inputMode="numeric" value={row.count || ""} onChange={(event) => updateDenomination(index, event.target.value)} /></td><td>{money(row.denominationMinor * row.count, currency)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Tổng kiểm đếm</th><td className={declaredMismatch ? styles.amountDanger : styles.amountGood}>{money(denomTotal, currency)}</td></tr></tfoot></table>{declaredMismatch && <div className={styles.inlineError} role="alert">Tổng theo mệnh giá không khớp số tiền thực tế đã khai báo.</div>}</div>}</div><div className={styles.cardFooterActions}><button className={styles.outlineButton} type="button" onClick={recount} disabled={saving}>Kiểm đếm lại</button><button className={styles.primaryButton} type="submit" form="cash-declare-form" disabled={!canDeclare}>{saving ? "Đang lưu…" : "Lưu kiểm đếm"}</button></div></section>
          <form id="cash-declare-form" className={styles.hiddenForm} onSubmit={(event) => void declare(event)} />

          <section className={styles.twoColumns}><section className={styles.card}><CardHeader eyebrow="3. ĐỐI SOÁT TIỀN MẶT" title="Đối soát tiền mặt" detail={revealed ? "Các giá trị dưới đây lấy từ cash movements và closing-review." : "Các số liệu hệ thống được bảo vệ trong chế độ blind count."} />{revealed ? <CashFlow flow={data.cashFlow} currency={currency} expected={expected} actual={session.declaredCashMinor} variance={variance} /> : <div className={styles.blindPanel}><Icon>◉</Icon><div><strong>Đối soát đang được che</strong><span>Chỉ số tiền thực tế bạn khai báo và bảng mệnh giá được hiển thị. Hệ thống sẽ tự đối soát sau khi gửi khai báo.</span></div></div>}</section><section className={styles.card}><CardHeader eyebrow="4. CHÊNH LỆCH TIỀN MẶT" title={revealed ? (variance == null ? "Chưa có chênh lệch" : variance === 0 ? "Không có chênh lệch" : "Có chênh lệch tiền mặt") : "Chênh lệch sẽ được đối soát sau"} detail={revealed ? "Variance authoritative từ backend." : "Không hiển thị expected hoặc variance trong blind count."} />{revealed ? <div className={variance === 0 ? styles.varianceGood : styles.varianceWarning}><strong>{money(variance, currency)}</strong><span>{highVariance ? `Vượt ngưỡng ${money(threshold, currency)}` : `Ngưỡng hiện tại ${money(threshold, currency)}`}</span></div> : <div className={styles.hiddenValue}>Được ẩn theo quyền blind count</div>}</section></section>

          {revealed && highVariance && <section className={styles.card}><CardHeader eyebrow="5. XÁC NHẬN CHÊNH LỆCH" title="Cần phê duyệt của quản lý" detail="Chênh lệch vượt threshold server trả về. Cashier không thể tự phê duyệt chênh lệch lớn của chính phiên mình." /><div className={styles.managerPanel}><div className={styles.managerVariance}><span>Chênh lệch cần phê duyệt</span><strong>{money(variance, currency)}</strong></div><label>Nguyên nhân chênh lệch<select value={reasonType} onChange={(event) => setReasonType(event.target.value)}>{varianceReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label>Ghi chú giải trình<textarea value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} placeholder="Ví dụ: Đã kiểm đếm lại hai lần và xác nhận tiền thiếu…" maxLength={1000} /></label><label className={styles.checkbox}><input type="checkbox" checked={varianceApproved} onChange={(event) => setVarianceApproved(event.target.checked)} /><span>Tôi đã xem xét chênh lệch và ghi rõ lý do.</span></label></div></section>}
        </>}

        {!closed && <section className={styles.twoColumns}><section className={styles.card}><CardHeader eyebrow="GIAO DỊCH CẦN XỬ LÝ" title="Giao dịch cần xử lý trước khi đóng ca" detail="PARTIALLY_PAID là cảnh báo; PENDING / AUTHORIZED là hard blocker từ backend." />{attention.length ? <AttentionList items={attention} currency={currency} /> : <div className={styles.emptyState}><Icon>✓</Icon><strong>Không có giao dịch cần chú ý</strong><span>Preflight hiện không ghi nhận blocker hoặc warning.</span></div>}</section><section className={styles.card}><CardHeader eyebrow="HOÀN TIỀN TRONG PHIÊN" title="Hoàn tiền trong phiên" detail="Chỉ hiển thị refund record thật từ API." />{data.refunds.length ? <div className={styles.refundList}>{data.refunds.map((refund) => <div className={styles.refundRow} key={refund.id}><span><strong>{refund.refundReference ?? "Hoàn tiền"}</strong><small>{dateTime(refund.occurredAt)} · {refund.reasonCode ?? "Không có lý do"}</small></span><b>{money(refund.amountMinor, currency)}</b></div>)}</div> : <div className={styles.emptyState}><Icon>—</Icon><strong>Không có hoàn tiền trong phiên</strong><span>Không dựng dữ liệu hoàn tiền từ fixture.</span></div>}</section></section>}

        {closing && <section className={styles.card}><CardHeader eyebrow="6. GHI CHÚ CUỐI CA" title="Ghi chú chênh lệch" detail="Backend hiện lưu varianceReason; không có nút lưu nháp giả." /><div className={styles.noteInfo}>{highVariance ? "Lý do sẽ được gửi cùng lệnh đóng phiên và lưu trong financial evidence." : "Có thể bổ sung lý do khi cần; dữ liệu chỉ được ghi nhận khi gọi command đóng phiên."}</div></section>}
      </div>

      <aside className={styles.rail}>
        <section className={styles.card}><CardHeader eyebrow="TÓM TẮT PHIÊN" title="Tóm tắt phiên" /> <dl className={styles.summary}><div><dt>Mã phiên</dt><dd>{session.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>Quầy</dt><dd>{data.register.name}</dd></div><div><dt>Thu ngân</dt><dd>{data.cashier.displayName}</dd></div><div><dt>Mở lúc</dt><dd>{timeOnly(session.openedAt)}</dd></div><div><dt>Trạng thái</dt><dd><StatusPill status={session.status} /></dd></div></dl></section>
        <section className={styles.card}><CardHeader eyebrow="TỔNG QUAN PHIÊN" title="Số liệu tài chính" detail="Session-scoped, không dùng doanh thu toàn ngày." /> <dl className={styles.summary}><div><dt>Doanh thu phiên</dt><dd>{money(data.metrics.sessionSalesMinor, currency)}</dd></div><div><dt>Đã thu tiền</dt><dd>{money(data.metrics.totalCapturedMinor, currency)}</dd></div><div><dt>Tiền mặt</dt><dd>{revealed ? money(data.metrics.cashCapturedMinor, currency) : "Được ẩn"}</dd></div><div><dt>Giao dịch</dt><dd>{data.metrics.capturedOrderCount}</dd></div></dl>{data.metrics.paymentMix && <div className={styles.mixList}>{Object.entries(data.metrics.paymentMix).map(([type, value]) => <div key={type}><span>{type === "CASH" ? "Tiền mặt" : type === "CARD_EXTERNAL" ? "Thẻ" : type === "BANK_TRANSFER" ? "Chuyển khoản" : "Khác"}</span><b>{money(value.amountMinor, currency)}</b></div>)}</div>}</section>
        <section className={styles.card}><CardHeader eyebrow="ĐIỀU KIỆN ĐÓNG PHIÊN" title="Closing readiness" /> <div className={styles.readiness}>{[
          ["Đã kiểm tra thanh toán đang xử lý", blockers.length === 0],
          ["Đã kiểm đếm tiền mặt", session.declaredCashMinor != null],
          ["Không còn blocker từ backend", blockers.length === 0],
          ["Đã ghi lý do chênh lệch lớn", !highVariance || Boolean(reasonDetail.trim())],
        ].map(([label, pass]) => <div className={pass ? styles.readinessPass : styles.readinessWarn} key={String(label)}><span>{pass ? "✓" : "!"}</span>{label}</div>)}</div>{open && <button type="button" className={styles.primaryWide} disabled={!canWrite || blockers.length > 0} onClick={() => void beginClosing()}>{saving ? "Đang bắt đầu…" : "Bắt đầu kiểm đếm"}</button>}{closing && <button type="button" className={styles.primaryWide} disabled={!canClose} onClick={() => setConfirmOpen(true)}>{highVariance ? "Xác nhận đóng phiên" : "Xác nhận đóng phiên"}</button>}</section>
        <section className={styles.card}><CardHeader eyebrow="SAU KHI ĐÓNG PHIÊN" title="Kết quả dự kiến" /> <ul className={styles.consequenceList}><li><span>✓</span><div><strong>Phiên chuyển sang CLOSED</strong><small>Ghi nhận vào lịch sử tài chính.</small></div></li><li><span>✓</span><div><strong>Quầy không còn phiên đang mở</strong><small>Sẵn sàng mở phiên mới.</small></div></li><li><span>✓</span><div><strong>Không nhận thanh toán mới</strong><small>Giao dịch mới cần phiên khác.</small></div></li></ul></section>
        {reviewError && <div className={styles.reviewNotice} role="status"><Icon>i</Icon><span>Không mở closing-review với tài khoản hiện tại. Blind count vẫn được bảo vệ.</span></div>}
        {refreshing && <p className={styles.refreshing}>↻ Đang cập nhật dữ liệu phiên…</p>}
      </aside>
    </div>

    <footer className={styles.stickyFooter}><a className={styles.secondaryButton} href={detailHref}>← &nbsp;Quay lại chi tiết phiên</a><div>{closing && <button className={styles.outlineButton} type="button" onClick={recount} disabled={saving}>Kiểm đếm lại</button>}{open && <button className={styles.primaryButton} type="button" disabled={!canWrite || blockers.length > 0} onClick={() => void beginClosing()}>Bắt đầu kiểm đếm</button>}{closing && <button className={styles.primaryButton} type="button" disabled={!canClose} onClick={() => setConfirmOpen(true)}>Xác nhận đóng phiên</button>}{closed && <a className={styles.primaryButton} href={detailHref}>Xem chi tiết phiên</a>}</div></footer>

    {confirmOpen && <div className={styles.dialogBackdrop}><div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-close-title"><div className={styles.dialogIcon}>?</div><h2 id="confirm-close-title">Xác nhận đóng phiên?</h2><p>Hành động này sẽ chuyển phiên thu ngân sang trạng thái CLOSED.</p><dl className={styles.dialogSummary}><div><dt>Quầy</dt><dd>{data.register.name}</dd></div><div><dt>Tiền thực tế đã khai báo</dt><dd>{money(session.declaredCashMinor, currency)}</dd></div>{revealed && <><div><dt>Tiền mặt dự kiến</dt><dd>{money(expected, currency)}</dd></div><div><dt>Chênh lệch</dt><dd>{money(variance, currency)}</dd></div></>}{!revealed && <div className={styles.dialogBlind}><dt>Đối soát hệ thống</dt><dd>Hệ thống sẽ tự đối soát khi đóng phiên.</dd></div>}</dl>{highVariance && <div className={styles.dialogWarning} role="alert">Đây là chênh lệch vượt threshold. Approval và variance reason sẽ được kiểm tra lại bởi backend.</div>}<div className={styles.dialogActions}><button className={styles.outlineButton} type="button" onClick={() => setConfirmOpen(false)}>Quay lại</button><button className={styles.primaryButton} type="button" disabled={!canClose} onClick={() => void closeSession()}>{saving ? "Đang đóng…" : "Xác nhận đóng phiên"}</button></div></div></div>}
  </main>;
}

function CardHeader({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return <header className={styles.cardHeader}>{<div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>}</header>;
}

function CashFlow({ flow, currency, expected, actual, variance }: { flow: Overview["cashFlow"]; currency: string; expected: Money; actual: Money; variance: Money }) {
  const rows: Array<[string, Money]> = [["Tiền đầu ca", flow.openingFloatMinor], ["Thu tiền mặt", flow.cashSalesMinor], ["Tiền nộp thêm", flow.cashInMinor], ["Chi / chuyển két", (flow.cashOutMinor ?? 0) + (flow.cashDropMinor ?? 0)], ["Hoàn tiền mặt", flow.cashRefundMinor]];
  return <div className={styles.flow}><div className={styles.flowRows}>{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{money(value, currency)}</b></div>)}</div><div className={styles.flowTotal}><span>Dự kiến cuối ca</span><strong>{money(expected, currency)}</strong></div><div className={styles.reconcileMini}><div><span>Thực tế</span><strong>{money(actual, currency)}</strong></div><div><span>Chênh lệch</span><strong className={variance === 0 ? styles.goodText : styles.dangerText}>{money(variance, currency)}</strong></div></div></div>;
}

function AttentionList({ items, currency }: { items: Attention[]; currency: string }) {
  return <div className={styles.attentionList}>{items.map((item) => <div className={item.blocking ? styles.attentionBlocking : styles.attentionWarning} key={`${item.code}-${item.orderId ?? item.paymentId ?? item.message}`}><span>{item.blocking ? "!" : "i"}</span><div><strong>{attentionLabels[item.code] ?? item.code}</strong><p>{item.message}</p>{item.amountMinor != null && <small>{money(item.amountMinor, currency)}</small>}{item.orderId && <a href={`/admin/pos/orders/${item.orderId}`}>Mở giao dịch →</a>}</div></div>)}</div>;
}
