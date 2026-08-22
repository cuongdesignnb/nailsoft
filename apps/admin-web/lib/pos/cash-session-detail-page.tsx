/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "../auth";
import styles from "./cash-session-detail-page.module.css";

type SessionStatus = "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
type Session = {
  id: string;
  branchId: string;
  registerId: string;
  registerCode: string;
  cashDrawerId: string;
  drawerCode: string;
  cashierUserId: string;
  businessDate: string;
  timezone: string;
  currency: string;
  status: SessionStatus;
  blindCount: boolean;
  openedAt: string;
  closedAt?: string | null;
  closingStartedAt?: string | null;
  openingFloatMinor: number | null;
  expectedCashMinor: number | null;
  declaredCashMinor: number | null;
  varianceMinor: number | null;
  version: number;
};
type MoneyValue = number | null;
type Transaction = {
  orderId: string;
  orderNumber?: string | null;
  customerDisplayName?: string | null;
  status: string;
  capturedAt?: string | null;
  paymentReference?: string | null;
  paymentMethods: string[];
  totalMinor: MoneyValue;
  capturedMinor: MoneyValue;
  cashCapturedMinor: MoneyValue;
};
type Attention = {
  code: string;
  severity: "BLOCKING" | "WARNING";
  blocking: boolean;
  message: string;
  orderId?: string | null;
  paymentId?: string | null;
  amountMinor: MoneyValue;
};
type Overview = {
  session: Session;
  register: { id: string; code: string; name: string; branchId: string; branchName: string };
  cashier: { id: string; displayName: string };
  metrics: {
    paidOrderCount: number;
    capturedOrderCount: number;
    sessionSalesMinor: MoneyValue;
    totalCapturedMinor: MoneyValue;
    cashCapturedMinor: MoneyValue;
    partialOrderCount: number;
    paymentMix: Record<string, { amountMinor: MoneyValue; paymentCount: number }> | null;
  };
  cashFlow: {
    openingFloatMinor: MoneyValue;
    cashSalesMinor: MoneyValue;
    cashInMinor: MoneyValue;
    cashOutMinor: MoneyValue;
    cashDropMinor: MoneyValue;
    cashRefundMinor: MoneyValue;
    expectedCashMinor: MoneyValue;
  };
  movements: Array<{
    id: string;
    movementType: string;
    direction: string;
    amountMinor: MoneyValue;
    currency: string;
    reasonCode?: string | null;
    occurredAt?: string | null;
  }>;
  refunds: Array<{
    id: string;
    refundReference?: string | null;
    status: string;
    amountMinor: MoneyValue;
    currency: string;
    occurredAt?: string | null;
    reasonCode?: string | null;
  }>;
  attention: Attention[];
  closingReadiness: { canBeginClosing: boolean; blockers: Attention[]; warnings: Attention[] };
  recentActivity: Array<{
    id: string;
    type: string;
    label: string;
    occurredAt?: string | null;
    amountMinor: MoneyValue;
    currency: string;
    orderId?: string | null;
    refundId?: string | null;
  }>;
  transactions: {
    items: Transaction[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
  generatedAt: string;
  lastUpdated: string;
};
type ApiBody = { data?: Overview; error?: { message?: string; code?: string } };

const statusLabels: Record<string, string> = {
  OPEN: "Đang mở",
  CLOSING: "Đang đóng phiên",
  CLOSED: "Đã đóng",
  CANCELLED: "Đã hủy",
  PAID: "Đã thanh toán",
  PARTIALLY_PAID: "Thanh toán một phần",
  READY_FOR_PAYMENT: "Chờ thanh toán",
  DRAFT: "Bản nháp",
  VOIDED: "Đã hủy",
  EXPIRED: "Hết hạn",
};
const paymentLabels: Record<string, string> = {
  CASH: "Tiền mặt",
  CARD_EXTERNAL: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
  OTHER_EXTERNAL: "Khác",
};

function getData(body: ApiBody) {
  return body.data;
}

async function getOverview(path: string) {
  const response = await authorizedFetch(path);
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Không thể tải chi tiết phiên thu ngân."), {
      code: body.error?.code,
      status: response.status,
    });
  }
  const data = getData(body);
  if (!data) throw new Error("API không trả về dữ liệu phiên thu ngân.");
  return data;
}

function money(value: MoneyValue, currency = "VND") {
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
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function shortId(value: string) {
  return `#${value.slice(0, 8).toUpperCase()}`;
}

function statusText(value: string) {
  return statusLabels[value] ?? "Không xác định";
}

function duration(openedAt: string, status: SessionStatus, closedAt?: string | null) {
  const end = status === "CLOSED" && closedAt ? new Date(closedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.floor((end - new Date(openedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} giờ ${minutes % 60} phút` : `${minutes} phút`;
}

function statusClass(value: string) {
  return value === "CLOSED" ? styles.statusClosed : value === "CLOSING" ? styles.statusClosing : styles.statusOpen;
}

function StatusPill({ value }: { value: string }) {
  return <span className={`${styles.statusPill} ${statusClass(value)}`}><i />{statusText(value)}</span>;
}

function Icon({ children }: { children: string }) {
  return <span className={styles.icon} aria-hidden="true">{children}</span>;
}

export default function CashSessionDetailPage({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [online, setOnline] = useState(true);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      const result = await getOverview(`/v1/cash-sessions/${encodeURIComponent(sessionId)}/overview?${params.toString()}`);
      setData(result);
      setLastSuccess(new Date().toISOString());
      setError("");
    } catch (reason: any) {
      setError(reason?.message ?? "Không thể tải chi tiết phiên thu ngân.");
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [page, search, sessionId, status]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  if (loading && !data) return <LoadingState />;
  if (!data) {
    return <main className={styles.page}><div className={styles.errorCard} role="alert"><strong>Không thể tải chi tiết phiên</strong><p>{error || "Phiên thu ngân không tồn tại hoặc bạn không có quyền xem."}</p><button type="button" onClick={() => void load()}>Thử lại</button></div></main>;
  }

  const { session, metrics } = data;
  const currency = session.currency;
  const closeHref = `/admin/pos/cash-sessions/${encodeURIComponent(session.id)}/close`;
  const canClose = session.status === "OPEN" && data.closingReadiness.canBeginClosing;
  const closeLabel = session.status === "CLOSING" ? "Tiếp tục đóng phiên" : session.status === "OPEN" ? "Chuẩn bị đóng phiên" : "Phiên đã đóng";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.breadcrumb}><a href="/admin/pos/registers">POS</a><b>/</b><a href="/admin/pos/registers">Quầy thu ngân</a><b>/</b>Chi tiết phiên</p>
          <div className={styles.titleLine}><div><h1>Chi tiết phiên thu ngân</h1><p className={styles.subtitle}>Theo dõi giao dịch, dòng tiền và tình trạng đối soát của phiên hiện tại.</p></div><StatusPill value={session.status} /></div>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href={`/admin/pos/registers?registerId=${encodeURIComponent(data.register.id)}`}>Quản lý quầy</a>
          {session.status === "OPEN" && !data.closingReadiness.canBeginClosing ? <button className={styles.primaryButton} type="button" disabled>Chưa sẵn sàng đóng phiên</button> : session.status !== "CLOSED" && session.status !== "CANCELLED" ? <a className={styles.primaryButton} href={closeHref}>{closeLabel}</a> : null}
        </div>
      </header>

      {session.status === "CLOSING" && <div className={`${styles.notice} ${styles.noticeAmber}`} role="status"><Icon>◷</Icon><span><strong>Phiên đang trong quy trình đóng phiên.</strong> Kiểm đếm và xác nhận tiếp tục trên màn hình đóng phiên.</span><a href={closeHref}>Tiếp tục →</a></div>}
      {session.blindCount && <div className={`${styles.notice} ${styles.noticeBlue}`} role="status"><Icon>◉</Icon><span><strong>Đang bật chế độ kiểm đếm mù.</strong> Số tiền dự kiến và các khoản tiền mặt được ẩn cho đến khi hoàn tất quy trình đóng phiên.</span></div>}
      {error && <div className={styles.inlineError} role="alert">{error}<button type="button" onClick={() => void load()}>Thử lại</button></div>}

      <section className={styles.heroCard} aria-labelledby="session-hero-title">
        <div className={styles.heroIdentity}><div className={styles.heroIcon}>▣</div><div><p className={styles.eyebrow}>PHIÊN THU NGÂN</p><h2 id="session-hero-title">{shortId(session.id)}</h2><p>{data.register.name} · {data.register.code}</p><StatusPill value={session.status} /></div></div>
        <div className={styles.heroStats}><div><span>Chi nhánh</span><strong>{data.register.branchName}</strong></div><div><span>Thu ngân phụ trách</span><strong>{data.cashier.displayName}</strong></div><div><span>Mở lúc</span><strong>{dateTime(session.openedAt, session.timezone)}</strong></div><div><span>Thời gian hoạt động</span><strong>{duration(session.openedAt, session.status, session.closedAt)}</strong></div></div>
        <div className={styles.heroExpected}><span>Tiền mặt dự kiến</span><strong>{session.blindCount ? "Được ẩn" : money(session.expectedCashMinor, currency)}</strong><small>{session.closedAt ? `Đóng lúc ${timeOnly(session.closedAt, session.timezone)}` : online ? "Cập nhật realtime" : "Mất kết nối"}</small></div>
      </section>

      <section className={styles.kpiGrid} aria-label="Tổng quan phiên">
        <Kpi icon="▣" label="Tiền đầu ca" value={money(session.blindCount ? null : session.openingFloatMinor, currency)} tone="pink" note={session.blindCount ? "Ẩn theo quyền kiểm đếm" : "Nguồn từ cash movement"} />
        <Kpi icon="$" label="Doanh thu phiên" value={money(metrics.sessionSalesMinor, currency)} tone="rose" note={`${metrics.paidOrderCount} đơn đã thanh toán`} />
        <Kpi icon="◉" label="Đã thu tiền" value={money(metrics.totalCapturedMinor, currency)} tone="green" note={metrics.cashCapturedMinor == null ? "Ẩn theo quyền kiểm đếm" : `${money(metrics.cashCapturedMinor, currency)} tiền mặt`} />
        <Kpi icon="#" label="Giao dịch" value={String(metrics.capturedOrderCount)} tone="blue" note="Đếm theo đơn, không đếm trùng split tender" />
        <Kpi icon="!" label="Cần chú ý" value={String(data.attention.length)} tone={data.closingReadiness.blockers.length ? "amber" : "green"} note={data.closingReadiness.blockers.length ? "Có blocker đóng phiên" : "Không có blocker"} />
      </section>

      <div className={styles.workspace}>
        <div className={styles.mainColumn}>
          <section className={styles.card} aria-labelledby="transactions-title">
            <div className={styles.cardHeader}><div><h2 id="transactions-title">Giao dịch trong phiên</h2><p>Thanh toán được gắn theo quầy, thu ngân và khoảng thời gian của phiên.</p></div><span className={styles.liveState}><i className={online ? styles.dotGreen : styles.dotRed} />{refreshing ? "Đang cập nhật" : online ? "Đang theo dõi" : "Offline"}</span></div>
            <form className={styles.filters} onSubmit={submitSearch}><label className={styles.searchBox}><span aria-hidden="true">⌕</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm mã đơn / khách hàng..." aria-label="Tìm giao dịch" /></label><label className={styles.selectField}><span>Trạng thái</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Tất cả</option><option value="PAID">Đã thanh toán</option><option value="PARTIALLY_PAID">Thanh toán một phần</option><option value="READY_FOR_PAYMENT">Chờ thanh toán</option></select></label><button className={styles.filterButton} type="submit">Tìm kiếm</button><button className={styles.refreshButton} type="button" onClick={() => void load(true)} aria-label="Làm mới">↻</button></form>
            <div className={styles.tableWrap}><table><caption className={styles.srOnly}>Danh sách giao dịch trong phiên thu ngân</caption><thead><tr><th>Thời gian</th><th>Mã đơn</th><th>Khách hàng</th><th>Phương thức</th><th>Tổng đơn</th><th>Đã thu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{data.transactions.items.length ? data.transactions.items.map((item) => <tr key={item.orderId}><td>{timeOnly(item.capturedAt, session.timezone)}</td><td><a className={styles.orderLink} href={`/admin/pos/orders/${item.orderId}`}>{item.orderNumber ?? shortId(item.orderId)}</a></td><td>{item.customerDisplayName || "Khách vãng lai"}</td><td><div className={styles.methodList}>{item.paymentMethods.map((method) => <span key={method}>{paymentLabels[method] ?? method}</span>)}</div></td><td><strong>{money(item.totalMinor, currency)}</strong></td><td><strong>{money(item.capturedMinor, currency)}</strong>{item.cashCapturedMinor != null && item.cashCapturedMinor !== item.capturedMinor && <small className={styles.subValue}>Mặt: {money(item.cashCapturedMinor, currency)}</small>}</td><td><span className={styles.tableStatus}>{statusText(item.status)}</span></td><td><a className={styles.tableAction} href={`/admin/pos/orders/${item.orderId}`}>Xem đơn</a></td></tr>) : <tr><td colSpan={8}><div className={styles.emptyTable}><span>◌</span><strong>Chưa có giao dịch được gắn vào phiên</strong><small>Dữ liệu sẽ xuất hiện khi thanh toán được ghi nhận theo đúng phiên và quầy.</small></div></td></tr>}</tbody></table></div>
            <div className={styles.tableFooter}><span>Hiển thị {data.transactions.items.length} / {data.transactions.pagination.total} đơn</span><div className={styles.pagination}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><span>Trang {page} / {data.transactions.pagination.totalPages}</span><button type="button" disabled={page >= data.transactions.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>→</button></div></div>
          </section>

          <div className={styles.twoColumns}>
            <CashFlow data={data} />
            <PaymentMix data={data} />
          </div>
          <div className={styles.twoColumns}>
            <Activity data={data} />
            <Refunds data={data} />
          </div>
        </div>

        <aside className={styles.rail} aria-label="Thông tin phiên thu ngân">
          <section className={styles.card}><div className={styles.cardHeader}><div><h2>Thông tin phiên</h2><p>{shortId(session.id)}</p></div><StatusPill value={session.status} /></div><dl className={styles.detailList}><Detail label="Quầy" value={`${data.register.name} · ${data.register.code}`} /><Detail label="Chi nhánh" value={data.register.branchName} /><Detail label="Thu ngân" value={data.cashier.displayName} /><Detail label="Ngày kinh doanh" value={session.businessDate} /><Detail label="Mở lúc" value={dateTime(session.openedAt, session.timezone)} /></dl><a className={styles.outlineButton} href={`/admin/pos/registers?registerId=${encodeURIComponent(data.register.id)}`}>Xem quầy thu ngân</a></section>
          <section className={styles.card}><div className={styles.cardHeader}><div><h2>Tiền mặt trong quầy</h2><p>Giá trị authoritative từ phiên.</p></div></div>{session.blindCount ? <div className={styles.hiddenPanel}><strong>Đang bật kiểm đếm mù</strong><span>Các breakdown tiền mặt được giữ kín cho đến bước đối soát.</span></div> : <><strong className={styles.railAmount}>{money(data.cashFlow.expectedCashMinor, currency)}</strong><dl className={styles.detailList}><Detail label="Tiền đầu ca" value={money(data.cashFlow.openingFloatMinor, currency)} /><Detail label="Thu tiền mặt" value={`+${money(data.cashFlow.cashSalesMinor, currency)}`} positive /><Detail label="Tiền vào khác" value={`+${money(data.cashFlow.cashInMinor, currency)}`} positive /><Detail label="Chi / nộp tiền" value={`-${money((data.cashFlow.cashOutMinor ?? 0) + (data.cashFlow.cashDropMinor ?? 0), currency)}`} /><Detail label="Hoàn tiền mặt" value={`-${money(data.cashFlow.cashRefundMinor, currency)}`} /></dl></>}</section>
          <AttentionCard data={data} />
          <section className={styles.card}><div className={styles.cardHeader}><div><h2>Đóng phiên</h2><p>Tuân thủ blocker từ backend.</p></div></div>{session.status === "CLOSED" ? <div className={styles.successPanel}><strong>Phiên đã đóng</strong><span>Phiên chỉ còn ở chế độ xem.</span></div> : data.closingReadiness.blockers.length ? <div className={styles.warningPanel}><strong>Chưa sẵn sàng đóng phiên</strong><span>{data.closingReadiness.blockers.length} thanh toán cần hoàn tất trước khi bắt đầu đóng.</span></div> : <div className={styles.successPanel}><strong>Có thể bắt đầu đóng phiên</strong><span>Kiểm đếm và xác nhận ở màn hình đóng phiên.</span></div>}{session.status !== "CLOSED" && session.status !== "CANCELLED" && <a className={`${styles.primaryWide} ${!canClose && session.status === "OPEN" ? styles.disabledLink : ""}`} href={canClose || session.status === "CLOSING" ? closeHref : undefined} aria-disabled={!canClose && session.status === "OPEN"}>{closeLabel}</a>}</section>
          <section className={styles.card}><h2>Thao tác nhanh</h2><a className={styles.actionRow} href="/admin/pos/orders"><Icon>▤</Icon><span>Xem đơn hàng POS</span><b>→</b></a><a className={styles.actionRow} href={`/admin/pos/registers?registerId=${encodeURIComponent(data.register.id)}`}><Icon>▣</Icon><span>Mở quản lý quầy</span><b>→</b></a><div className={styles.health}><i className={online && lastSuccess ? styles.dotGreen : styles.dotRed} /><span>{online && lastSuccess ? "Kết nối dữ liệu ổn định" : "Cần kiểm tra kết nối"}</span><small>{lastSuccess ? `Lần cập nhật ${timeOnly(lastSuccess, session.timezone)}` : "Chưa có lần tải thành công"}</small></div></section>
        </aside>
      </div>

      <footer className={styles.stickyFooter}><a className={styles.secondaryButton} href="/admin/pos/registers">← Quay lại quản lý quầy</a><div><a className={styles.secondaryButton} href={`/admin/pos/orders?cashSessionId=${encodeURIComponent(session.id)}`}>Xem đơn hàng</a>{session.status !== "CLOSED" && session.status !== "CANCELLED" && <a className={`${styles.primaryButton} ${!canClose && session.status === "OPEN" ? styles.disabledLink : ""}`} href={canClose || session.status === "CLOSING" ? closeHref : undefined} aria-disabled={!canClose && session.status === "OPEN"}>{closeLabel}</a>}</div></footer>
    </main>
  );
}

function Kpi({ icon, label, value, note, tone }: { icon: string; label: string; value: string; note: string; tone: string }) {
  return <article className={styles.kpi}><span className={`${styles.kpiIcon} ${styles[`tone_${tone}`]}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function Detail({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div><dt>{label}</dt><dd className={positive ? styles.positive : undefined}>{value}</dd></div>;
}

function CashFlow({ data }: { data: Overview }) {
  const { cashFlow, session } = data;
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>Dòng tiền mặt</h2><p>Phân rã từ cash movements của phiên.</p></div><Icon>◌</Icon></div>{session.blindCount ? <div className={styles.hiddenPanel}><strong>Breakdown đang được ẩn</strong><span>Chỉ hiển thị sau khi hoàn tất kiểm đếm.</span></div> : <div className={styles.flowList}><FlowRow label="Tiền đầu ca" value={money(cashFlow.openingFloatMinor, data.session.currency)} /><FlowRow label="Thu tiền mặt" value={`+${money(cashFlow.cashSalesMinor, data.session.currency)}`} positive /><FlowRow label="Tiền vào khác" value={`+${money(cashFlow.cashInMinor, data.session.currency)}`} positive /><FlowRow label="Chi / nộp tiền" value={`-${money((cashFlow.cashOutMinor ?? 0) + (cashFlow.cashDropMinor ?? 0), data.session.currency)}`} /><FlowRow label="Hoàn tiền mặt" value={`-${money(cashFlow.cashRefundMinor, data.session.currency)}`} /><div className={styles.flowTotal}><span>Tiền mặt dự kiến</span><strong>{money(cashFlow.expectedCashMinor, data.session.currency)}</strong></div></div>}</section>;
}

function FlowRow({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div className={styles.flowRow}><span>{label}</span><strong className={positive ? styles.positive : undefined}>{value}</strong></div>;
}

function PaymentMix({ data }: { data: Overview }) {
  const mix = data.metrics.paymentMix;
  const total = useMemo(() => Object.values(mix ?? {}).reduce((sum, item) => sum + (item.amountMinor ?? 0), 0), [mix]);
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>Phân bổ thanh toán</h2><p>Tính trên số tiền đã capture.</p></div></div>{mix ? <div className={styles.mixList}>{Object.entries(mix).length ? Object.entries(mix).map(([key, item]) => <div className={styles.mixRow} key={key}><div className={styles.mixLabel}><i className={`${styles.mixDot} ${styles[`mix_${key}`]}`} /><span>{paymentLabels[key] ?? key}</span><small>{item.paymentCount} giao dịch</small></div><div className={styles.progress}><span style={{ width: `${total ? Math.min(100, ((item.amountMinor ?? 0) / total) * 100) : 0}%` }} /></div><strong>{money(item.amountMinor, data.session.currency)}</strong></div>) : <div className={styles.emptySmall}>Chưa có payment capture.</div>}<div className={styles.mixTotal}><span>Tổng đã thu</span><strong>{money(data.metrics.totalCapturedMinor, data.session.currency)}</strong></div></div> : <div className={styles.hiddenPanel}><strong>Phân bổ đang được ẩn</strong><span>Vai trò hiện tại không được xem số tiền chi tiết.</span></div>}</section>;
}

function Activity({ data }: { data: Overview }) {
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>Lịch sử hoạt động</h2><p>Sự kiện đã được ghi nhận từ hệ thống.</p></div></div>{data.recentActivity.length ? <div className={styles.activityList}>{data.recentActivity.slice(0, 8).map((item) => <div className={styles.activityItem} key={`${item.type}-${item.id}`}><i /><div><strong>{item.label}</strong><small>{dateTime(item.occurredAt, data.session.timezone)}{item.amountMinor != null ? ` · ${money(item.amountMinor, item.currency)}` : ""}</small></div>{item.orderId && <a href={`/admin/pos/orders/${item.orderId}`}>Xem đơn</a>}</div>)}</div> : <div className={styles.emptySmall}>Chưa có hoạt động được lưu cho phiên.</div>}</section>;
}

function Refunds({ data }: { data: Overview }) {
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>Hoàn tiền & điều chỉnh</h2><p>Chỉ hiển thị hoàn tiền thực tế gắn với phiên.</p></div></div>{data.refunds.length ? <div className={styles.refundList}>{data.refunds.map((item) => <div className={styles.refundItem} key={item.id}><span className={styles.refundIcon}>↩</span><div><strong>{item.refundReference ?? shortId(item.id)}</strong><small>{statusText(item.status)} · {dateTime(item.occurredAt, data.session.timezone)}</small></div><b>{money(item.amountMinor, item.currency)}</b><a href={`/admin/refunds/${item.id}`}>Xem</a></div>)}</div> : <div className={styles.emptySmall}>Chưa có hoàn tiền hoặc điều chỉnh tiền mặt gắn với phiên.</div>}</section>;
}

function AttentionCard({ data }: { data: Overview }) {
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>Cần kiểm tra</h2><p>{data.attention.length ? `${data.attention.length} vấn đề từ read-model phiên.` : "Không có ngoại lệ."}</p></div><span className={data.closingReadiness.blockers.length ? styles.countWarning : styles.countGood}>{data.attention.length}</span></div>{data.attention.length ? <div className={styles.attentionList}>{data.attention.slice(0, 6).map((item, index) => <div className={`${styles.attentionItem} ${item.blocking ? styles.attentionBlocking : ""}`} key={`${item.code}-${item.orderId ?? item.paymentId ?? index}`}><span>{item.blocking ? "!" : "i"}</span><div><strong>{item.blocking ? "Blocker đóng phiên" : "Cảnh báo"}</strong><p>{item.message}</p>{item.amountMinor != null && <small>{money(item.amountMinor, data.session.currency)}</small>}</div></div>)}</div> : <div className={styles.successPanel}><strong>Phiên đang ổn định</strong><span>Không có thanh toán chờ xử lý hoặc cảnh báo cần theo dõi.</span></div>}</section>;
}

function LoadingState() {
  return <main className={styles.page}><div className={styles.loadingHeader}><div /><div /></div><div className={styles.loadingGrid}>{[1, 2, 3, 4, 5, 6].map((value) => <div className={styles.skeleton} key={value} />)}</div></main>;
}
