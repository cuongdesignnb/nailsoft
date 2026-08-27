/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch, getActiveBranchId, setActiveBranchId } from "./auth";
import { legacyValue } from "./legacy-workspace-ui";

type RemoteState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline" | "stale";
type RemoteValue = { state: RemoteState; data: any; error: string; code: string | undefined; load: () => Promise<void> };

function unwrap(body: any): any {
  return body?.data ?? body;
}

function errorFrom(body: any, fallback = "Không thể hoàn tất yêu cầu.") {
  return body?.error?.message ?? body?.message ?? fallback;
}

function posStatusLabel(value: any) {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    DRAFT: "Bản nháp", READY_FOR_PAYMENT: "Chờ thanh toán", PARTIALLY_PAID: "Đã thanh toán một phần",
    PAID: "Đã thanh toán", OPEN: "Đang mở", CLOSED: "Đã đóng", CLOSING: "Đang chốt sổ",
    COUNTED: "Đã kiểm đếm", VARIANCE_REVIEW: "Chờ kiểm tra chênh lệch", FAILED: "Thất bại",
    CANCELLED: "Đã hủy", UNKNOWN: "Chưa xác định", LOCKED: "Đã khóa",
    REVIEW: "Đang rà soát", EARNING: "Phát sinh", REFUND_REVERSAL: "Đảo do hoàn tiền",
    LOCKED_PERIOD_REFUND_ADJUSTMENT: "Điều chỉnh đảo trong kỳ đã khóa",
    MANUAL_ADJUSTMENT: "Điều chỉnh thủ công",
  };
  return labels[raw] ?? raw.replaceAll("_", " ");
}

function commissionEntryLabel(value: any) {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    EARNING: "Hoa hồng phát sinh",
    REFUND_REVERSAL: "Đảo hoa hồng do hoàn tiền",
    LOCKED_PERIOD_REFUND_ADJUSTMENT: "Điều chỉnh đảo trong kỳ đã khóa",
    MANUAL_ADJUSTMENT: "Điều chỉnh thủ công",
  };
  return labels[raw] ?? raw.replaceAll("_", " ");
}

async function read(path: string, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw Object.assign(new Error("Cần có kết nối mạng để tiếp tục."), { offline: true });
  }
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem màn hình này."), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(errorFrom(body)), { code: body?.error?.code, status: response.status });
  }
  return unwrap(body);
}

async function command(path: string, body: unknown, idempotencyKey?: string) {
  return read(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey ?? crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

function useIntentKeys() {
  const keys = useRef<Record<string, string>>({});
  return {
    key(intent: string) {
      return (keys.current[intent] ??= crypto.randomUUID());
    },
    clear(intent: string) {
      delete keys.current[intent];
    },
  };
}

function useRemote(path: string | null): RemoteValue {
  const [state, setState] = useState<RemoteState>(path ? "loading" : "empty");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [code, setCode] = useState<string>();
  const load = useCallback(async () => {
    if (!path) {
      setState("empty");
      return;
    }
    setState("loading");
    setError("");
    setCode(undefined);
    try {
      const value = await read(path);
      setData(value);
      const empty = Array.isArray(value) ? value.length === 0 : value == null;
      setState(empty ? "empty" : "ready");
    } catch (reason: any) {
      setError(reason?.message ?? "Không thể tải dữ liệu.");
      setCode(reason?.code);
      setState(reason?.offline ? "offline" : reason?.forbidden ? "forbidden" : "error");
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { if (state === "offline") void load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, state]);
  return { state, data, error, code, load };
}

function money(value: any, currency = "VND") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(number / (currency === "VND" ? 1 : 100));
}

function label(value: any, fallback = "—") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  return value?.["vi-VN"] ?? value?.["en-US"] ?? value?.name ?? fallback;
}

function statusTone(value: any) {
  const status = String(value ?? "").toUpperCase();
  if (["PAID", "SUCCEEDED", "COMPLETED", "CLOSED", "APPROVED", "ACTIVE"].includes(status)) return "success";
  if (["FAILED", "REJECTED", "VOID", "CANCELLED", "UNKNOWN"].includes(status)) return "danger";
  if (["PENDING", "PROCESSING", "DRAFT", "OPEN", "PARTIALLY_PAID"].includes(status)) return "warning";
  return "info";
}

function Status({ value }: { value: any }) {
  return <span className={`w2-status w2-status-${statusTone(value)}`}>{posStatusLabel(value)}</span>;
}

function AsyncPanel({ value, label: title }: { value: RemoteValue; label: string }) {
  if (value.state === "ready") return null;
  if (value.state === "loading") return <div className="w2-state" role="status" aria-live="polite"><span className="w2-spinner" /> Đang tải {title}…</div>;
  if (value.state === "forbidden") return <div className="w2-state w2-state-danger" role="alert"><h2 className="w2-state-heading">Không có quyền truy cập</h2><span>Màn hình này nằm ngoài vai trò hoặc phạm vi chi nhánh hiện tại.</span></div>;
  if (value.state === "offline") return <div className="w2-state w2-state-warning" role="alert"><strong>Cần kết nối Internet</strong><span>Các thao tác tài chính chỉ thực hiện khi đang trực tuyến.</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Thử lại</button></div>;
  if (value.state === "empty") return <div className="w2-state" role="status"><strong>Chưa có {title}</strong><span>Chưa có dữ liệu trong phạm vi chi nhánh này.</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Làm mới</button></div>;
  return <div className="w2-state w2-state-danger" role="alert"><strong>{value.code === "VERSION_CONFLICT" ? "Dữ liệu đã thay đổi" : "Không thể tải dữ liệu"}</strong><span>{value.error}</span><button className="w2-button w2-button-secondary" onClick={() => void value.load()}>Thử lại</button></div>;
}

function Page({ title, eyebrow, description, children, actions }: { title: string; eyebrow: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return <main className="w2-page"><header className="w2-page-head"><div><p className="w2-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="w2-actions">{actions}</div>}</header>{children}</main>;
}

function useBranch() {
  const branches = useRemote("/v1/branches");
  const [id, setId] = useState(getActiveBranchId() ?? "");
  useEffect(() => {
    if (!id && Array.isArray(branches.data) && branches.data[0]?.id) {
      setId(branches.data[0].id);
      setActiveBranchId(branches.data[0].id);
    }
  }, [branches.data, id]);
  const set = (next: string) => { setId(next); setActiveBranchId(next || undefined); };
  return { branches, id, set };
}

function BranchSelect({ branch }: { branch: ReturnType<typeof useBranch> }) {
  return <label className="w2-field"><span>Chi nhánh làm việc</span><select value={branch.id} onChange={(e) => branch.set(e.target.value)}><option value="">Chọn chi nhánh</option>{(Array.isArray(branch.branches.data) ? branch.branches.data : []).map((item: any) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{label(item.name, item.id)}</option>)}</select></label>;
}

function RefundEvidence({ data }: { data: any }) {
  const items = Array.isArray(data.items) ? data.items : [];
  const allocations = Array.isArray(data.paymentAllocations) ? data.paymentAllocations : [];
  return <div className="w2-evidence-stack">
    <section className="w2-evidence-section">
      <div className="w2-card-head"><div><p className="w2-eyebrow">DÒNG HOÀN</p><h3>Các dòng được hoàn</h3></div><span className="w2-protection">{items.length} dòng</span></div>
      {items.length ? <div className="w2-table-wrap w2-table-wrap-inner"><table className="w2-table"><thead><tr><th scope="col">Loại</th><th scope="col">Số lượng</th><th scope="col">Tiền hàng</th><th scope="col">Thuế</th><th scope="col">Tổng hoàn</th></tr></thead><tbody>{items.map((item: any, index: number) => <tr key={item.id ?? item.invoiceLineId ?? index}><td><strong>{label(item.itemType, "Dòng hóa đơn")}</strong><small>{legacyValue(item.invoiceLineId, "invoiceLineId")}</small></td><td>{item.quantity ?? "—"}</td><td className="w2-money">{money(item.grossRefundMinor, data.currency)}</td><td className="w2-money">{money(item.taxRefundMinor, data.currency)}</td><td className="w2-money">{money(item.totalRefundMinor, data.currency)}</td></tr>)}</tbody></table></div> : <div className="w2-empty">Chưa có dòng hoàn được trả từ máy chủ.</div>}
    </section>
    <div className="w2-evidence-grid">
      <section className="w2-evidence-section"><div className="w2-card-head"><div><p className="w2-eyebrow">PHÂN BỔ THANH TOÁN</p><h3>Phương thức hoàn</h3></div></div>{allocations.length ? <div className="w2-table-wrap w2-table-wrap-inner"><table className="w2-table"><thead><tr><th scope="col">Phương thức</th><th scope="col">Dự kiến</th><th scope="col">Đã thực hiện</th><th scope="col">Trạng thái</th></tr></thead><tbody>{allocations.map((allocation: any, index: number) => <tr key={allocation.id ?? allocation.originalPaymentId ?? index}><td><strong>{label(allocation.tenderType, "Thanh toán")}</strong><small>{legacyValue(allocation.originalPaymentId, "originalPaymentId")}</small></td><td className="w2-money">{money(allocation.plannedMinor, data.currency)}</td><td className="w2-money">{money(allocation.completedMinor, data.currency)}</td><td><Status value={allocation.status} /></td></tr>)}</tbody></table></div> : <div className="w2-empty">Chưa có phân bổ thanh toán.</div>}</section>
      <section className="w2-evidence-section"><div className="w2-card-head"><div><p className="w2-eyebrow">CHÍNH SÁCH</p><h3>Thông tin hoàn tiền</h3></div><Status value={data.status} /></div><dl className="w2-summary"><div><dt>Lý do</dt><dd>{label(data.reasonCode)}</dd></div><div><dt>Tiền tip hoàn</dt><dd>{money(data.tipRefundMinor, data.currency)}</dd></div><div><dt>Credit Note</dt><dd>{data.creditNote?.creditNoteNumber ?? "Chưa phát hành"}</dd></div><div><dt>Phiên bản dữ liệu</dt><dd>{data.version ?? "—"}</dd></div></dl></section>
    </div>
  </div>;
}

function CreditNoteEvidence({ data }: { data: any }) {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const context = data.context ?? {};
  const invoice = context.invoice ?? {};
  const refund = context.refund ?? {};
  return <div className="w2-evidence-stack">
    <section className="w2-evidence-section"><div className="w2-card-head"><div><p className="w2-eyebrow">DÒNG CHỨNG TỪ</p><h3>Chi tiết Credit Note</h3></div><span className="w2-protection">{lines.length} dòng</span></div>{lines.length ? <div className="w2-table-wrap w2-table-wrap-inner"><table className="w2-table"><thead><tr><th scope="col">Nội dung</th><th scope="col">Số lượng</th><th scope="col">Tiền hàng</th><th scope="col">Thuế</th><th scope="col">Tổng</th></tr></thead><tbody>{lines.map((line: any, index: number) => <tr key={line.id ?? index}><td><strong>{label(line.descriptionSnapshot ?? line.description_snapshot_json, "Dòng hoàn")}</strong><small>{legacyValue(line.originalInvoiceLineId ?? line.original_invoice_line_id, "originalInvoiceLineId")}</small></td><td>{line.quantity ?? "—"}</td><td className="w2-money">{money(Number(line.grossMinor ?? line.gross_minor ?? 0), data.currency)}</td><td className="w2-money">{money(Number(line.taxMinor ?? line.tax_minor ?? 0), data.currency)}</td><td className="w2-money">{money(Number(line.totalMinor ?? line.total_minor ?? 0), data.currency)}</td></tr>)}</tbody></table></div> : <div className="w2-empty">Chưa có dòng Credit Note.</div>}</section>
    <div className="w2-evidence-grid"><section className="w2-evidence-section"><div className="w2-card-head"><div><p className="w2-eyebrow">CHỨNG TỪ GỐC</p><h3>Hóa đơn và hoàn tiền</h3></div></div><dl className="w2-summary"><div><dt>Hóa đơn</dt><dd>{invoice.number ?? legacyValue(invoice.id, "invoiceId")}</dd></div><div><dt>Giá trị hóa đơn gốc</dt><dd>{money(invoice.originalGrandTotalMinor, data.currency)}</dd></div><div><dt>Refund</dt><dd>{refund.reference ?? legacyValue(refund.id, "refundId")}</dd></div><div><dt>Trạng thái Refund</dt><dd><Status value={refund.status} /></dd></div></dl></section><section className="w2-evidence-section"><div className="w2-card-head"><div><p className="w2-eyebrow">KIỂM SOÁT</p><h3>Giá trị sau điều chỉnh</h3></div></div><dl className="w2-summary"><div><dt>Đã điều chỉnh lũy kế</dt><dd>{money(invoice.cumulativeAdjustmentMinor, data.currency)}</dd></div><div><dt>Giá trị còn lại</dt><dd>{money(invoice.adjustedInvoiceValueMinor, data.currency)}</dd></div><div><dt>Người phát hành</dt><dd>{context.issuer?.displayName ?? "—"}</dd></div><div><dt>Chi nhánh</dt><dd>{context.branch?.name ?? context.branch?.code ?? "—"}</dd></div></dl></section></div>
  </div>;
}

function Kpi({ label: title, value, detail, emphasis = false }: { label: string; value: ReactNode; detail?: string; emphasis?: boolean }) {
  return <article className={`w2-kpi ${emphasis ? "w2-kpi-emphasis" : ""}`}><span>{title}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function PosHome() {
  const branch = useBranch();
  const summary = useRemote(branch.id ? `/v1/financial/summary?branchId=${branch.id}` : null);
  const orders = useRemote(branch.id ? `/v1/pos-orders?branchId=${branch.id}` : null);
  const sessions = useRemote(branch.id ? `/v1/cash-sessions?branchId=${branch.id}&status=OPEN` : null);
  const totals = summary.data?.totals ?? summary.data ?? {};
  const openOrders = Array.isArray(orders.data) ? orders.data.filter((row: any) => ["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(row.status)) : [];
  return <Page title="Trung tâm POS" eyebrow="POS · HÔM NAY" description="Tổng quan bán hàng, trạng thái thanh toán và phiên thu ngân theo chi nhánh, lấy trực tiếp từ máy chủ." actions={<><a className="w2-button w2-button-primary" href="/admin/pos/new">Tạo đơn mới</a><a className="w2-button w2-button-secondary" href="/admin/pos/cash-sessions/open">Mở phiên thu ngân</a></>}><section className="w2-toolbar"><BranchSelect branch={branch} /><span className="w2-live"><span /> Chi nhánh đang hoạt động</span></section><AsyncPanel value={summary} label="tổng quan tài chính" />{summary.state === "ready" && <section className="w2-kpi-grid"><Kpi label="Doanh thu hôm nay" value={money(totals.todaySalesMinor ?? 0, totals.currency ?? "VND")} emphasis /><Kpi label="Đơn đang mở" value={openOrders.length} detail="Bản nháp hoặc chờ thanh toán" /><Kpi label="Đơn đã thanh toán" value={totals.paidOrders ?? 0} /><Kpi label="Tiền tip" value={money(totals.tipsMinor ?? 0, totals.currency ?? "VND")} /></section>}<section className="w2-dashboard-grid"><div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">CÔNG VIỆC ĐANG MỞ</p><h2>Đơn cần tiếp tục</h2></div><a href="/admin/pos/orders">Xem tất cả</a></div><AsyncPanel value={orders} label="đơn hàng" />{orders.state === "ready" && (openOrders.length ? <div className="w2-list">{openOrders.slice(0, 6).map((row: any) => <a className="w2-list-row" href={`/admin/pos/orders/${row.id}`} key={row.id}><span><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName ?? row.customer?.displayName, "Đơn khách lẻ")} · {posStatusLabel(row.status)}</small></span><b>{money(row.amountDueMinor ?? row.totalMinor ?? 0, row.currency)}</b></a>)}</div> : <div className="w2-empty">Chưa có đơn đang mở. Tạo đơn mới khi khách sẵn sàng.</div>)}</div><div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">TRẠNG THÁI THU NGÂN</p><h2>Phiên thu tiền đang mở</h2></div><a href="/admin/pos/registers">Quản lý quầy thu ngân</a></div><AsyncPanel value={sessions} label="phiên thu ngân đang mở" />{sessions.state === "ready" && (sessions.data.length ? <div className="w2-list">{sessions.data.slice(0, 4).map((row: any) => <a className="w2-list-row" href={`/admin/pos/cash-sessions/${row.id}`} key={row.id}><span><strong>{row.registerCode ?? row.registerId ?? "Quầy thu ngân"}</strong><small>{row.cashierName ?? row.cashierUserId ?? "Nhân viên phụ trách"} · {posStatusLabel(row.status)}</small></span><b>{row.blindCount ? "Đang kiểm đếm" : money(row.expectedCashMinor, row.currency)}</b></a>)}</div> : <div className="w2-empty"><strong>Chưa mở phiên thu ngân</strong><span>Mở phiên trước khi nhận thanh toán tiền mặt.</span><a className="w2-button w2-button-primary" href="/admin/pos/cash-sessions/open">Mở phiên thu ngân</a></div>)}</div></section></Page>;
}

function FinancialHome() {
  const branch = useBranch();
  const summary = useRemote(branch.id ? `/v1/financial/summary?branchId=${branch.id}` : null);
  const totals = summary.data?.totals ?? summary.data ?? {};
  return <Page title="Tài chính" eyebrow="TÀI CHÍNH · KIỂM SOÁT" description="Tổng quan tài chính theo chi nhánh, với các số liệu chi tiết và đối soát được mở từ các route hiện hành." actions={<a className="w2-button w2-button-primary" href="/admin/financial/net-sales">Mở báo cáo doanh thu</a>}><section className="w2-toolbar"><BranchSelect branch={branch} /></section><AsyncPanel value={summary} label="tổng quan tài chính" />{summary.state === "ready" && <section className="w2-kpi-grid"><Kpi label="Doanh thu hôm nay" value={money(totals.todaySalesMinor ?? 0, totals.currency ?? "VND")} emphasis /><Kpi label="Đơn đã thanh toán" value={totals.paidOrders ?? 0} /><Kpi label="Tiền tip" value={money(totals.tipsMinor ?? 0, totals.currency ?? "VND")} /><Kpi label="Đơn còn dang dở" value={totals.partialOrders ?? 0} /></section>}<section className="w2-card-grid"><a className="w2-card" href="/admin/financial/invoices"><h2>Hóa đơn</h2><p>Mở danh sách hóa đơn và chứng từ phát hành.</p></a><a className="w2-card" href="/admin/financial/payments"><h2>Thanh toán</h2><p>Tra cứu các khoản thanh toán và phân bổ.</p></a><a className="w2-card" href="/admin/financial/reconciliation"><h2>Đối soát thanh toán</h2><p>Kiểm tra giao dịch và bằng chứng đối soát.</p></a><a className="w2-card" href="/admin/financial/net-sales"><h2>Doanh thu thuần</h2><p>Xem báo cáo doanh thu theo kỳ.</p></a></section></Page>;
}

function Orders() {
  const branch = useBranch();
  const remote = useRemote(branch.id ? `/v1/pos-orders?branchId=${branch.id}` : null);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (Array.isArray(remote.data) ? remote.data : []).filter((row: any) => `${row.orderNumber ?? ""} ${row.id ?? ""} ${row.status ?? ""}`.toLowerCase().includes(query.toLowerCase())), [remote.data, query]);
  return <Page title="Đơn đang mở và chờ xử lý" eyebrow="POS · ĐƠN HÀNG" description="Tiếp tục xử lý đơn tại chi nhánh mà vẫn giữ nguyên phiên bản và bằng chứng thanh toán do máy chủ xác nhận." actions={<a className="w2-button w2-button-primary" href="/admin/pos/new">Tạo đơn mới</a>}><section className="w2-toolbar"><BranchSelect branch={branch} /><label className="w2-field w2-search"><span>Tìm đơn hàng hoặc mã tham chiếu</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Mã đơn hoặc mã tham chiếu…" /></label></section><AsyncPanel value={remote} label="đơn hàng" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Đơn hàng</th><th>Trạng thái</th><th>Chi nhánh</th><th>Còn phải thu</th><th>Phiên bản</th><th /></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName, "Khách lẻ")}</small></td><td><Status value={row.status} /></td><td>{row.branchCode ?? row.branchId}</td><td className="w2-money">{money(row.amountDueMinor ?? 0, row.currency)}</td><td>{row.version ?? "—"}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/orders/${row.id}`}>Mở đơn</a></td></tr>)}</tbody></table>{!rows.length && <div className="w2-empty">Không có đơn phù hợp với tìm kiếm này.</div>}</div>}</Page>;
}

function NewSale({ appointmentId }: { appointmentId?: string }) {
  const [appointment, setAppointment] = useState<any>();
  const [input, setInput] = useState(appointmentId ?? "");
  const [order, setOrder] = useState<any>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const intents = useIntentKeys();
  const appointmentRemote = useRemote(appointmentId ? `/v1/appointments/${appointmentId}` : null);
  useEffect(() => { if (appointmentRemote.state === "ready") setAppointment(appointmentRemote.data); }, [appointmentRemote.data, appointmentRemote.state]);
  async function loadAppointment(event: FormEvent) {
    event.preventDefault();
    setNotice(""); setError("");
    try { setAppointment(await read(`/v1/appointments/${input.trim()}`)); } catch (reason: any) { setError(reason.message); }
  }
  async function createOrder() {
    if (!input.trim()) return;
    setNotice(""); setError("");
    const intent = "create-pos-order";
    try { setOrder(await command(`/v1/appointments/${input.trim()}/pos-orders`, {}, intents.key(intent))); intents.clear(intent); setNotice("Đơn đã được mở từ snapshot lịch hẹn bất biến."); } catch (reason: any) { setError(reason.message); }
  }
  if (order) return <OrderWorkspace orderId={order.id} />;
  return <Page title="Tạo đơn bán hàng" eyebrow="POS · BÁN HÀNG" description="Liên kết lịch hẹn đã hoàn tất với đơn hàng do máy chủ tính toán. Thanh toán khách lẻ vẫn dùng theo hợp đồng hiện hành."><ol className="w2-stepper"><li className="is-active"><b>1</b><span>Chọn nguồn</span></li><li><b>2</b><span>Lập giỏ hàng</span></li><li><b>3</b><span>Thanh toán</span></li></ol><div className="w2-sale-grid"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">LỊCH HẸN HOẶC PHIÊN DỊCH VỤ</p><h2>Chọn nguồn tạo đơn</h2></div></div><form className="w2-form" onSubmit={(event) => void loadAppointment(event)}><label className="w2-field"><span>Mã lịch hẹn</span><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập mã lịch hẹn" required /><small>Tổng cuối luôn do API trả về; màn hình không tự tính số tiền nghiệp vụ.</small></label><div className="w2-actions"><button className="w2-button w2-button-secondary" type="submit">Kiểm tra lịch hẹn</button><button className="w2-button w2-button-primary" type="button" onClick={() => void createOrder()} disabled={!appointment}>Mở hoặc tạo đơn</button></div></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{notice && <div className="w2-notice w2-notice-success" role="status">{notice}</div>}{appointment && <div className="w2-source-card"><div><span className="w2-eyebrow">NGUỒN ĐÃ SẴN SÀNG</span><strong>{appointment.bookingReference ?? appointment.id}</strong><small>{label(appointment.contact?.displayName ?? appointment.customer?.displayName, "Khách lẻ")}</small></div><Status value={appointment.status} /><dl><div><dt>Sẵn sàng thanh toán</dt><dd>{appointment.checkoutReady ? "Có" : "Chưa"}</dd></div><div><dt>Dịch vụ</dt><dd>{appointment.items?.length ?? appointment.serviceItems?.length ?? "—"}</dd></div></dl></div>}</section><aside className="w2-card w2-guidance"><p className="w2-eyebrow">HƯỚNG DẪN THAO TÁC</p><h2>Thanh toán nhanh và an toàn</h2><ul><li>Dùng quầy thu ngân đã gán cho thiết bị này.</li><li>Giảm giá cần duyệt sẽ chờ người quản lý xử lý.</li><li>Mỗi lệnh có idempotency và tải lại tổng từ máy chủ.</li></ul></aside></div></Page>;
}

function OrderWorkspace({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const registers = useRemote("/v1/pos-registers");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const intents = useIntentKeys();
  async function mutate(path: string, body: any, success: string, intent = path): Promise<any> {
    if (!order.data) return;
    setSaving(true); setNotice(""); setError("");
    try { const result = await command(path, body, intents.key(intent)); intents.clear(intent); setNotice(success); await order.load(); return result; } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Đơn vừa thay đổi ở nơi khác; dữ liệu mới đã được tải lại." : reason.message); await order.load(); return undefined; } finally { setSaving(false); }
  }
  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await mutate(`/v1/pos-orders/${orderId}/lines`, { version: order.data.version, lineType: String(form.get("lineType")), description: String(form.get("description")), quantity: Number(form.get("quantity")), unitPriceMinor: Number(form.get("unitPriceMinor")), reasonCode: "FRONT_DESK_SALE" }, "Đã thêm dòng hàng và tải lại tổng tiền.");
    event.currentTarget.reset();
  }
  async function discount(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await mutate(`/v1/pos-orders/${orderId}/discounts`, { version: order.data.version, discountType: String(form.get("discountType")), value: Number(form.get("value")), reasonCode: String(form.get("reason")), note: String(form.get("note") ?? "") }, ""); if (result?.approvalRequired) setNotice(`Cần người quản lý phê duyệt: ${result.approvalRequestId}`); else if (result) setNotice("Đã áp dụng giảm giá."); }
  async function tip(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const amount = Number(new FormData(event.currentTarget).get("amountMinor")); await mutate(`/v1/pos-orders/${orderId}/tip`, { version: order.data.version, amountMinor: amount, source: "CASHIER_ENTRY", allocationBasis: "WORK_SECONDS" }, "Đã phân bổ tiền tip theo các phiên dịch vụ thực tế."); }
  async function assign(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const registerId = String(new FormData(event.currentTarget).get("registerId")); await mutate(`/v1/pos-orders/${orderId}/assign-register`, { version: order.data.version, registerId }, "Đã gán quầy thu ngân."); }
  if (order.state !== "ready") return <Page title="Không gian đơn hàng" eyebrow="POS · ĐƠN HÀNG"><AsyncPanel value={order} label="đơn hàng" /></Page>;
  const row = order.data;
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return <Page title="Chi tiết đơn hàng" eyebrow="POS · LẬP ĐƠN" description="Lập giỏ hàng ở bên trái, giữ phần tổng do máy chủ xác nhận ở bên phải và chỉ chuyển sang thanh toán khi quầy cùng các điều kiện phê duyệt đã hợp lệ." actions={<a className="w2-button w2-button-secondary" href="/admin/pos/orders">Quay lại đơn hàng</a>}><div className="w2-order-context"><span><strong>{row.orderNumber ?? row.id}</strong><small>{label(row.customerSnapshot?.displayName ?? row.customer?.displayName, "Khách lẻ")} · {row.branchCode ?? row.branchId} · {row.status} · phiên bản {row.version}</small></span><Status value={row.status} /></div>{notice && <div className="w2-notice w2-notice-success" role="status">{notice}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<div className="w2-sale-grid w2-sale-grid-wide"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">DÒNG HÀNG</p><h2>Dịch vụ và hàng bán</h2></div><span className="w2-muted">{lines.length} dòng</span></div>{lines.length ? <ul className="w2-line-list">{lines.map((line: any) => <li key={line.id}><div><strong>{label(line.description?.name ?? line.description, "Dòng hàng")}</strong><small>{line.lineType ?? line.sourceSnapshot?.reasonCode ?? "Dịch vụ"} · SL {line.quantity}</small></div><b>{money(line.netMinor ?? line.grossMinor, row.currency)}</b></li>)}</ul> : <div className="w2-empty">Chưa có dòng hàng. Thêm dịch vụ hoặc hàng bán để tiếp tục.</div>}{row.status === "DRAFT" && <form className="w2-inline-form" onSubmit={(event) => void addLine(event)}><input name="description" aria-label="Mô tả dòng hàng" placeholder="Thêm dịch vụ hoặc hàng bán" required /><select name="lineType" aria-label="Loại dòng hàng"><option value="MANUAL_SERVICE">Dịch vụ</option><option value="ADJUSTMENT">Hàng bán / điều chỉnh</option></select><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" aria-label="Số lượng" required /><input name="unitPriceMinor" type="number" min="0" placeholder="Đơn giá" aria-label="Đơn giá theo đơn vị nhỏ" required /><button className="w2-button w2-button-primary" disabled={saving}>Thêm dòng</button></form>}</section><aside className="w2-card w2-summary-card"><p className="w2-eyebrow">TỔNG DO MÁY CHỦ XÁC NHẬN</p><h2>Tóm tắt đơn hàng</h2><dl className="w2-totals"><div><dt>Tạm tính</dt><dd>{money(row.subtotalMinor, row.currency)}</dd></div><div><dt>Giảm giá</dt><dd>−{money(row.discountMinor, row.currency)}</dd></div><div><dt>Thuế</dt><dd>{money(row.taxMinor, row.currency)}</dd></div><div><dt>Tiền tip</dt><dd>{money(row.tipMinor, row.currency)}</dd></div><div className="w2-total"><dt>Còn phải thu</dt><dd>{money(row.amountDueMinor, row.currency)}</dd></div></dl>{row.status === "DRAFT" && <><form className="w2-stack-form" onSubmit={(event) => void assign(event)}><label className="w2-field"><span>Quầy thu ngân</span><select name="registerId" defaultValue={row.registerId ?? ""} required><option value="">Chọn quầy đang hoạt động</option>{(Array.isArray(registers.data) ? registers.data : []).filter((item: any) => item.status === "ACTIVE" && item.branchId === row.branchId).map((item: any) => <option key={item.id} value={item.id}>{item.code ?? item.name ?? item.id}</option>)}</select></label><button className="w2-button w2-button-secondary" disabled={saving}>Gán quầy</button></form><button className="w2-button w2-button-primary w2-full" disabled={saving || !row.registerId || !lines.length} onClick={() => void mutate(`/v1/pos-orders/${orderId}/finalize`, { version: row.version }, "Đã chốt đơn. Giá được giữ bất biến.")}>Chốt đơn</button></>}{["READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(row.status) && <a className="w2-button w2-button-primary w2-full" href={`/admin/pos/orders/${orderId}/payment`}>Thu tiền</a>}{row.status === "PAID" && <a className="w2-button w2-button-primary w2-full" href={`/admin/pos/orders/${orderId}/receipt`}>Mở biên lai bất biến</a>}</aside></div>{row.status === "DRAFT" && <section className="w2-action-grid"><form className="w2-card w2-stack-form" onSubmit={(event) => void discount(event)}><div><p className="w2-eyebrow">PHÊ DUYỆT</p><h2>Giảm giá</h2></div><label className="w2-field"><span>Loại</span><select name="discountType"><option value="FIXED">Số tiền theo đơn vị nhỏ</option><option value="PERCENT">Tỷ lệ theo điểm cơ bản</option></select></label><label className="w2-field"><span>Giá trị</span><input name="value" type="number" min="0" required /></label><label className="w2-field"><span>Lý do</span><input name="reason" defaultValue="CUSTOMER_CARE" required /></label><label className="w2-field"><span>Ghi chú nhân viên</span><textarea name="note" /></label><button className="w2-button w2-button-secondary" disabled={saving}>Áp dụng / gửi phê duyệt</button></form><form className="w2-card w2-stack-form" onSubmit={(event) => void tip(event)}><div><p className="w2-eyebrow">TIỀN TIP</p><h2>Tiền tip</h2></div><label className="w2-field"><span>Số tiền tip theo đơn vị nhỏ</span><input name="amountMinor" type="number" min="0" required /></label><small className="w2-muted">Phân bổ theo các phiên dịch vụ thực tế trong lịch sử thực hiện.</small><button className="w2-button w2-button-secondary" disabled={saving}>Lưu và phân bổ tip</button></form></section>}</Page>;
}

function Payment({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const sessions = useRemote("/v1/cash-sessions?status=OPEN");
  const [tender, setTender] = useState("CASH");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const intents = useIntentKeys();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!order.data) return;
    const form = new FormData(event.currentTarget); const amount = Number(form.get("amountToApplyMinor"));
    const body: any = { version: order.data.version, tenderType: tender, amountToApplyMinor: amount };
    if (tender === "CASH") Object.assign(body, { cashReceivedMinor: Number(form.get("cashReceivedMinor")), cashSessionId: String(form.get("cashSessionId")) });
    if (tender === "CARD_EXTERNAL") Object.assign(body, { provider: "manual-terminal", providerTransactionId: String(form.get("reference")), cardLast4: String(form.get("last4") || "") || undefined });
    if (tender === "BANK_TRANSFER") Object.assign(body, { providerTransactionId: String(form.get("reference")), receivedAt: new Date().toISOString(), evidenceNote: "Verified by cashier" });
    setSubmitting(true); setMessage(""); setError("");
    const intent = "capture-payment";
    try { const result = await command(`/v1/pos-orders/${orderId}/payments`, body, intents.key(intent)); intents.clear(intent); const status = result?.status ?? result?.payment?.status ?? "RECORDED"; setMessage(tender === "CARD_EXTERNAL" ? "Đã ghi nhận bằng chứng thanh toán ngoài hệ thống." : `Máy chủ trả trạng thái thanh toán: ${status}. Tổng tiền đã được tải lại.`); await order.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Thanh toán chưa được gửi vì đơn vừa thay đổi; dữ liệu hiện tại đã được tải lại." : reason.message); await order.load(); } finally { setSubmitting(false); }
  }
  if (order.state !== "ready") return <Page title="Thanh toán" eyebrow="POS · THANH TOÁN"><AsyncPanel value={order} label="đơn hàng" /></Page>;
  const row = order.data;
  return <Page title="Thu tiền" eyebrow="POS · THANH TOÁN" description="Chọn từng phương thức thanh toán được hỗ trợ. Máy chủ xác nhận phân bổ cuối cùng và số tiền còn phải thu sau mỗi lần ghi nhận." actions={<a className="w2-button w2-button-secondary" href={`/admin/pos/orders/${orderId}`}>Quay lại đơn hàng</a>}><div className="w2-checkout-layout"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">KIỂM TRA LẦN CUỐI</p><h2>{row.orderNumber}</h2><p className="w2-muted">{label(row.customerSnapshot?.displayName, "Khách lẻ")} · {row.branchCode ?? row.branchId}</p></div><Status value={row.status} /></div><dl className="w2-totals w2-totals-large"><div><dt>Tổng tiền</dt><dd>{money(row.totalMinor, row.currency)}</dd></div><div><dt>Đã thu</dt><dd>{money(row.paidMinor, row.currency)}</dd></div><div className="w2-total"><dt>Còn phải thu</dt><dd>{money(row.amountDueMinor, row.currency)}</dd></div></dl><h3>Khoản đã ghi nhận</h3><div className="w2-list">{(row.payments ?? []).length ? row.payments.map((payment: any) => <div className="w2-list-row" key={payment.id}><span><strong>{payment.tenderType}</strong><small>{payment.providerTransactionId ?? payment.id} · {payment.status}</small></span><b>{money(payment.capturedMinor ?? payment.amountMinor, payment.currency ?? row.currency)}</b></div>) : <div className="w2-empty">Chưa có khoản thanh toán nào.</div>}</div></section><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">THAO TÁC THANH TOÁN</p><h2>Thu phần còn lại</h2></div><span className="w2-protection">Có idempotency</span></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{row.amountDueMinor > 0 ? <form className="w2-stack-form" onSubmit={(event) => void submit(event)}><label className="w2-field"><span>Phương thức</span><select value={tender} onChange={(e) => setTender(e.target.value)}><option value="CASH">Tiền mặt</option><option value="CARD_EXTERNAL">Thiết bị thẻ ngoài hệ thống</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="OTHER_EXTERNAL">Phương thức ngoài hệ thống khác</option></select></label><label className="w2-field"><span>Số tiền áp dụng theo đơn vị nhỏ</span><input name="amountToApplyMinor" type="number" min="1" max={row.amountDueMinor} defaultValue={row.amountDueMinor} required /></label>{tender === "CASH" && <><label className="w2-field"><span>Tiền khách đưa</span><input name="cashReceivedMinor" type="number" min="1" defaultValue={row.amountDueMinor} required /></label><label className="w2-field"><span>Phiên thu ngân đang mở</span><select name="cashSessionId" required><option value="">Chọn phiên</option>{(Array.isArray(sessions.data) ? sessions.data : []).map((session: any) => <option key={session.id} value={session.id}>{session.registerCode ?? session.registerId} · {session.cashierName ?? session.cashierUserId}</option>)}</select></label></>}{tender !== "CASH" && <label className="w2-field"><span>Mã tham chiếu ngoài hệ thống</span><input name="reference" required /></label>}{tender === "CARD_EXTERNAL" && <label className="w2-field"><span>Chỉ nhập 4 số cuối thẻ</span><input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} /></label>}<button className="w2-button w2-button-primary w2-full" disabled={submitting}>{submitting ? "Đang ghi nhận…" : "Ghi nhận một lần"}</button><p className="w2-helper">Nếu nhà cung cấp trả về UNKNOWN, không thử lại ngay. Kiểm tra trạng thái thanh toán trước khi tạo lần mới.</p></form> : <div className="w2-notice w2-notice-success" role="status">Đơn đã thanh toán đủ. Mở biên lai bất biến để kiểm tra.</div>}</section></div></Page>;
}

function Receipt({ orderId }: { orderId: string }) {
  const order = useRemote(`/v1/pos-orders/${orderId}`);
  const invoiceId = order.state === "ready" ? order.data?.invoice?.id ?? order.data?.invoiceId : null;
  const receipt = useRemote(invoiceId ? `/v1/invoices/${invoiceId}/print` : null);
  return <Page title="Biên lai" eyebrow="POS · BIÊN LAI" description="Hóa đơn đã phát hành và bằng chứng thanh toán chỉ đọc. Điều chỉnh phải đi qua luồng hoàn tiền hoặc Credit Note." actions={<a className="w2-button w2-button-secondary" href={`/admin/pos/orders/${orderId}`}>Quay lại đơn hàng</a>}><AsyncPanel value={order} label="đơn đã thanh toán" />{order.state === "ready" && !invoiceId && <div className="w2-state w2-state-warning" role="alert"><strong>Chưa phát hành hóa đơn.</strong><span>Máy chủ chưa xác nhận hóa đơn đã chốt cho đơn này.</span></div>}{invoiceId && <AsyncPanel value={receipt} label="biên lai" />}{receipt.state === "ready" && <div className="w2-card w2-receipt-card"><div><p className="w2-eyebrow">HÓA ĐƠN</p><h2>{receipt.data.invoiceNumber ?? invoiceId}</h2><p>{label(receipt.data.branchSnapshot?.name ?? order.data?.branchCode, "Chi nhánh")} · {receipt.data.issuedAt ?? "Máy chủ đã phát hành"}</p></div><div className="w2-receipt-total">{money(receipt.data.totalMinor, receipt.data.currency)}</div><dl className="w2-totals"><div><dt>Đã thu</dt><dd>{money(receipt.data.paidMinor, receipt.data.currency)}</dd></div><div><dt>Tiền tip</dt><dd>{money(receipt.data.tipMinor, receipt.data.currency)}</dd></div><div><dt>Trạng thái thanh toán</dt><dd><Status value="PAID" /></dd></div></dl><button className="w2-button w2-button-primary" onClick={() => window.print()}>In biên lai</button><small className="w2-helper">Xác minh {receipt.data.verificationCode ?? "bằng chứng bất biến"}</small></div>}</Page>;
}

function Registers() {
  const branch = useBranch(); const remote = useRemote(branch.id ? `/v1/pos-registers?branchId=${branch.id}` : "/v1/pos-registers");
  return <Page title="Quầy và ngăn tiền" eyebrow="TIỀN MẶT · QUẦY" description="Xác nhận chi nhánh, thiết bị và phạm vi nhân viên trước khi mở ngăn tiền." actions={<a className="w2-button w2-button-primary" href="/admin/pos/cash-sessions/open">Mở quầy</a>}><section className="w2-toolbar"><BranchSelect branch={branch} /></section><AsyncPanel value={remote} label="quầy thu ngân" />{remote.state === "ready" && <div className="w2-card-grid">{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <article className="w2-card w2-register-card" key={row.id}><div className="w2-card-head"><div><p className="w2-eyebrow">QUẦY THU NGÂN</p><h2>{row.code ?? row.name ?? row.id}</h2></div><Status value={row.status} /></div><dl className="w2-summary"><div><dt>Chi nhánh</dt><dd>{row.branchCode ?? row.branchId}</dd></div><div><dt>Ngăn tiền</dt><dd>{(row.drawers ?? []).map((drawer: any) => drawer.code ?? drawer.name ?? drawer.id).join(" · ") || "Chưa gán ngăn tiền"}</dd></div><div><dt>Thiết bị</dt><dd>{row.deviceId ?? "Theo chính sách"}</dd></div><div><dt>Nhân viên</dt><dd>{row.assignedUserName ?? row.assignedUserId ?? "Chưa gán"}</dd></div></dl></article>)}</div>}</Page>;
}

function OpenRegister() {
  const registers = useRemote("/v1/pos-registers"); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const intents = useIntentKeys();
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const intent = "open-cash-session"; setSaving(true); setError(""); setMessage(""); try { await command("/v1/cash-sessions/open", { registerId: String(form.get("registerId")), cashDrawerId: String(form.get("cashDrawerId")), openingFloatMinor: Number(form.get("openingFloatMinor")), deviceId: String(form.get("deviceId") || "admin-web") }, intents.key(intent)); intents.clear(intent); setMessage("Đã mở phiên thu ngân. Quay lại tổng quan POS để kiểm tra ngữ cảnh hiện tại."); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } }
  return <Page title="Mở phiên thu ngân" eyebrow="TIỀN MẶT · MỞ PHIÊN" description="Mở ngăn tiền bằng lệnh có kiểm soát, idempotency và ràng buộc thiết bị, chi nhánh." ><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">GÁN QUẦY</p><h2>Tiền đầu ca</h2></div></div><AsyncPanel value={registers} label="quầy thu ngân" /><form className="w2-stack-form" onSubmit={(event) => void submit(event)}><label className="w2-field"><span>Quầy thu ngân</span><select name="registerId" required><option value="">Chọn quầy</option>{(Array.isArray(registers.data) ? registers.data : []).filter((row: any) => row.status === "ACTIVE").map((row: any) => <option key={row.id} value={row.id}>{row.code ?? row.name ?? row.id}</option>)}</select></label><label className="w2-field"><span>Mã ngăn tiền</span><input name="cashDrawerId" required /></label><label className="w2-field"><span>Tiền đầu ca theo đơn vị nhỏ</span><input name="openingFloatMinor" type="number" min="0" required /></label><label className="w2-field"><span>Thiết bị</span><input name="deviceId" defaultValue="admin-web" /></label><button className="w2-button w2-button-primary" disabled={saving}>{saving ? "Đang mở…" : "Mở quầy"}</button></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}</section><aside className="w2-card w2-guidance"><p className="w2-eyebrow">ĐIỀU KIỆN</p><h2>Trước khi mở phiên</h2><ul><li>Quầy phải đang hoạt động và thuộc chi nhánh hiện tại.</li><li>Máy chủ xác nhận ràng buộc thiết bị và người vận hành.</li><li>Không thể mở trùng phiên nhờ ràng buộc nghiệp vụ.</li></ul></aside></div></Page>;
}

function CashSessions() { const branch = useBranch(); const remote = useRemote(branch.id ? `/v1/cash-sessions?branchId=${branch.id}` : null); return <Page title="Lịch sử phiên thu ngân" eyebrow="TIỀN MẶT · LỊCH SỬ" description="Các phiên mở, đang chốt và đã đóng luôn gắn với nhân viên cùng quầy thu ngân thực tế."><section className="w2-toolbar"><BranchSelect branch={branch} /></section><AsyncPanel value={remote} label="phiên thu ngân" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Quầy thu ngân</th><th>Nhân viên</th><th>Trạng thái</th><th>Tiền kỳ vọng</th><th>Thời điểm mở</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.registerCode ?? row.registerId}</strong><small>{row.branchCode ?? row.branchId}</small></td><td>{row.cashierName ?? row.cashierUserId}</td><td><Status value={row.status} /></td><td>{row.blindCount ? "Ẩn đến khi kiểm đếm" : money(row.expectedCashMinor, row.currency)}</td><td>{row.openedAt ? new Date(row.openedAt).toLocaleString("vi-VN") : "—"}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/cash-sessions/${row.id}`}>Mở chi tiết</a></td></tr>)}</tbody></table></div>}</Page>; }

function CashSession({ sessionId, close = false }: { sessionId: string; close?: boolean }) {
  const value = useRemote(`/v1/cash-sessions/${sessionId}`); const movements = useRemote(`/v1/cash-sessions/${sessionId}/movements`); const review = useRemote(close ? `/v1/cash-sessions/${sessionId}/closing-review` : null); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const intents = useIntentKeys();
  async function act(path: string, body: any, success: string) { if (!value.data) return; try { await command(path, { version: value.data.version, ...body }, intents.key(path)); intents.clear(path); setMessage(success); await value.load(); await movements.load(); await review.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Phiên vừa thay đổi; dữ liệu mới đã được tải lại." : reason.message); await value.load(); } }
  async function move(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await act(`/v1/cash-sessions/${sessionId}/movements`, { movementType: String(form.get("movementType")), amountMinor: Number(form.get("amountMinor")), reasonCode: String(form.get("reasonCode")), note: String(form.get("note") ?? "") }, "Đã ghi nhận biến động tiền mặt."); event.currentTarget.reset(); }
  async function declare(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const amount = Number(new FormData(event.currentTarget).get("declaredCashMinor")); await act(`/v1/cash-sessions/${sessionId}/declare`, { declaredCashMinor: amount }, "Đã gửi số đếm mù để rà soát."); }
  if (value.state !== "ready") return <Page title="Ngăn tiền" eyebrow="TIỀN MẶT · PHIÊN"><AsyncPanel value={value} label="phiên thu ngân" /></Page>;
  const row = value.data; const items = Array.isArray(movements.data) ? movements.data : [];
  return <Page title={`Ngăn tiền · ${row.registerCode ?? row.registerId}`} eyebrow="TIỀN MẶT · NGĂN TIỀN" description="Lịch sử biến động chỉ ghi thêm. Đóng phiên theo từng bước với số đếm mù và rà soát chênh lệch." actions={<a className="w2-button w2-button-secondary" href="/admin/pos/cash-sessions">Quay lại phiên thu ngân</a>}><div className="w2-order-context"><span><strong>{row.cashierName ?? row.cashierUserId}</strong><small>{row.branchCode ?? row.branchId} · phiên bản {row.version}</small></span><Status value={row.status} /></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<section className="w2-kpi-grid"><Kpi label="Tiền đầu ca" value={money(row.openingFloatMinor, row.currency)} /><Kpi label="Tiền kỳ vọng" value={row.blindCount ? "Ẩn đến khi kiểm đếm" : money(row.expectedCashMinor, row.currency)} emphasis /><Kpi label="Thu vào / chi ra" value={`${money(row.totalPaidInMinor ?? 0, row.currency)} / ${money(row.totalPaidOutMinor ?? 0, row.currency)}`} /><Kpi label="Phiên" value={<Status value={row.status} />} /></section><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">BIẾN ĐỘNG CHỈ GHI THÊM</p><h2>Hoạt động ngăn tiền</h2></div></div><AsyncPanel value={movements} label="biến động" />{movements.state === "ready" && (items.length ? <div className="w2-list">{items.map((item: any) => <div className="w2-list-row" key={item.id}><span><strong>{item.movementType ?? item.type}</strong><small>{item.reasonCode} · {item.actorUserId ?? item.operatorName ?? "Nhân viên thao tác"}</small></span><b>{money(item.amountMinor, row.currency)}</b></div>)}</div> : <div className="w2-empty">Chưa có biến động tiền mặt.</div>)}{row.status === "OPEN" && <form className="w2-stack-form w2-top-gap" onSubmit={(event) => void move(event)}><h3>Ghi nhận biến động</h3><label className="w2-field"><span>Loại</span><select name="movementType"><option value="CASH_IN">Thu vào</option><option value="CASH_OUT">Chi ra</option><option value="CASH_DROP">Nộp tiền</option></select></label><label className="w2-field"><span>Số tiền theo đơn vị nhỏ</span><input name="amountMinor" type="number" min="1" required /></label><label className="w2-field"><span>Lý do</span><input name="reasonCode" required /></label><label className="w2-field"><span>Ghi chú</span><textarea name="note" /></label><button className="w2-button w2-button-secondary">Ghi nhận biến động</button></form>}</section><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">QUY TRÌNH ĐÓNG PHIÊN</p><h2>{close ? "Kiểm đếm mù và chênh lệch" : "Điều khiển phiên"}</h2></div></div>{row.status === "OPEN" && !close && <button className="w2-button w2-button-primary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/begin-closing`, {}, "Đã bắt đầu đóng phiên. Nhập số đếm mù ở bước tiếp theo.")}>Bắt đầu đóng phiên</button>}{(close || ["CLOSING", "COUNTED", "VARIANCE_REVIEW"].includes(row.status)) && <><AsyncPanel value={review} label="rà soát đóng phiên" />{review.state === "ready" && <dl className="w2-summary"><div><dt>Tiền kỳ vọng</dt><dd>{review.data.blindCount ? "Ẩn" : money(review.data.expectedCashMinor, row.currency)}</dd></div><div><dt>Ngưỡng chênh lệch</dt><dd>{money(review.data.varianceThresholdMinor ?? 0, row.currency)}</dd></div><div><dt>Phê duyệt</dt><dd><Status value={review.data.approvalStatus ?? row.status} /></dd></div></dl>}<form className="w2-stack-form w2-top-gap" onSubmit={(event) => void declare(event)}><label className="w2-field"><span>Tiền đếm thực tế theo đơn vị nhỏ</span><input name="declaredCashMinor" type="number" min="0" required /></label><button className="w2-button w2-button-primary">Gửi số đếm mù</button></form><div className="w2-actions w2-top-gap"><button className="w2-button w2-button-secondary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/reopen`, {}, "Đã mở lại phiên để kiểm đếm có kiểm soát.")}>Yêu cầu đếm lại / mở lại</button><button className="w2-button w2-button-primary" onClick={() => void act(`/v1/cash-sessions/${sessionId}/close`, { varianceReason: "Reviewed in register workflow" }, "Đã đóng quầy với chênh lệch được máy chủ phê duyệt.")}>Đóng phiên</button></div></>}</section></div></Page>;
}

function FinancialList({ kind }: { kind: "invoices" | "payments" | "reconciliation" | "net-sales" }) {
  const paths = { invoices: "/v1/invoices", payments: "/v1/payments", reconciliation: "/v1/financial/reconciliation/daily", "net-sales": "/v1/financial/net-sales" };
  const remote = useRemote(paths[kind]); const title = kind === "net-sales" ? "Doanh thu thuần" : kind === "invoices" ? "Hóa đơn" : kind === "payments" ? "Thanh toán" : "Đối soát";
  const rows = Array.isArray(remote.data) ? remote.data : remote.data?.rows ?? remote.data?.items ?? [];
  return <Page title={title} eyebrow="TÀI CHÍNH · BÁO CÁO" description="Bằng chứng tài chính chỉ đọc từ hợp đồng máy chủ hiện hành. Hóa đơn đã chốt không được sửa tại đây."><AsyncPanel value={remote} label={title.toLowerCase()} />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Tham chiếu</th><th>Trạng thái</th><th>Khách hàng / chi nhánh</th><th>Số tiền</th><th>Ngày tạo</th><th /></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id ?? row.invoiceId ?? row.paymentId}><td><strong>{row.invoiceNumber ?? row.orderNumber ?? row.reference ?? row.id}</strong><small>{row.id}</small></td><td><Status value={row.status ?? row.paymentStatus} /></td><td>{label(row.customerSnapshot?.displayName ?? row.branchCode ?? row.branchId, "—")}</td><td className="w2-money">{money(row.totalMinor ?? row.amountMinor ?? row.netSalesMinor ?? 0, row.currency)}</td><td>{row.createdAt ? new Date(row.createdAt).toLocaleDateString("vi-VN") : "—"}</td><td>{row.invoiceId && <a className="w2-button w2-button-secondary w2-button-small" href={`/admin/pos/orders/${row.posOrderId ?? row.orderId ?? ""}/receipt`}>Mở biên lai</a>}</td></tr>)}</tbody></table></div>}</Page>;
}

function RefundCreate() {
  const [invoiceId, setInvoiceId] = useState(""); const [lineId, setLineId] = useState(""); const [amount, setAmount] = useState(""); const [tip, setTip] = useState("0"); const [reason, setReason] = useState("CUSTOMER_REQUEST"); const [preview, setPreview] = useState<any>(); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const intents = useIntentKeys();
  async function plan(event: FormEvent) { event.preventDefault(); const intent = "refund-plan"; setError(""); setMessage(""); try { setPreview(await command(`/v1/invoices/${invoiceId}/refund-plans`, { items: [{ invoiceLineId: lineId, amountMinor: Number(amount) }], tipAmountMinor: Number(tip), refundDestination: "ORIGINAL_TENDER" }, intents.key(intent))); intents.clear(intent); } catch (reason: any) { setError(reason.message); } }
  async function create() { const intent = "create-refund"; setSaving(true); try { const result = await command(`/v1/invoices/${invoiceId}/refunds`, { items: [{ invoiceLineId: lineId, amountMinor: Number(amount) }], tipAmountMinor: Number(tip), refundDestination: "ORIGINAL_TENDER", reasonCode: reason, reasonText: "Requested through refund review" }, intents.key(intent)); intents.clear(intent); setMessage(`Đã tạo bản nháp hoàn tiền ${result.refundReference ?? result.id}.`); } catch (reason: any) { setError(reason.message); } finally { setSaving(false); } }
  return <Page title="Tạo yêu cầu hoàn tiền" eyebrow="ĐIỀU CHỈNH · HOÀN TIỀN" description="Xem trước dòng có thể hoàn và phân bổ phương thức thanh toán gốc trước khi tạo bản nháp. Mọi số tiền do máy chủ xác nhận."><div className="w2-two-col"><section className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">YÊU CẦU</p><h2>Chọn bằng chứng cần hoàn</h2></div><span className="w2-protection">Quản lý rà soát</span></div><form className="w2-stack-form" onSubmit={(event) => void plan(event)}><label className="w2-field"><span>Mã hóa đơn</span><input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} required /></label><label className="w2-field"><span>Mã dòng hóa đơn</span><input value={lineId} onChange={(e) => setLineId(e.target.value)} required /></label><label className="w2-field"><span>Số tiền dòng theo đơn vị nhỏ</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" required /></label><label className="w2-field"><span>Tiền tip cần đảo theo đơn vị nhỏ</span><input value={tip} onChange={(e) => setTip(e.target.value)} type="number" min="0" /></label><label className="w2-field"><span>Lý do</span><select value={reason} onChange={(e) => setReason(e.target.value)}><option>CUSTOMER_REQUEST</option><option>SERVICE_QUALITY</option><option>DUPLICATE_CHARGE</option></select></label><button className="w2-button w2-button-primary">Xem trước hoàn tiền</button></form>{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}</section><section className="w2-card"><p className="w2-eyebrow">XEM TRƯỚC DO MÁY CHỦ XÁC NHẬN</p><h2>Phân bổ và chính sách</h2>{preview ? <><dl className="w2-totals"><div><dt>Số tiền yêu cầu</dt><dd>{money(preview.requestedMinor, preview.currency)}</dd></div><div><dt>Thuế hoàn</dt><dd>{money(preview.taxRefundMinor, preview.currency)}</dd></div><div className="w2-total"><dt>Phê duyệt</dt><dd>{preview.approval?.required ? "Bắt buộc" : "Chính sách cho phép xử lý"}</dd></div></dl><p className="w2-helper">Phương thức gốc: {(preview.paymentAllocations ?? []).map((item: any) => `${item.tenderType} ${money(item.plannedMinor, preview.currency)}`).join(" · ") || "Máy chủ chưa trả phân bổ"}</p><button className="w2-button w2-button-primary" disabled={saving} onClick={() => void create()}>{saving ? "Đang tạo…" : "Tạo bản nháp hoàn tiền"}</button></> : <div className="w2-empty">Nhập bằng chứng dòng hóa đơn để xem số tiền còn có thể hoàn, thời hạn chính sách và phân bổ phương thức gốc.</div>}</section></div></Page>;
}

function Refunds() { const remote = useRemote("/v1/refunds"); return <Page title="Hàng đợi hoàn tiền" eyebrow="ĐIỀU CHỈNH · HOÀN TIỀN" description="Rà soát yêu cầu, phê duyệt, xử lý và trạng thái chưa xác định mà không che giấu bằng chứng từ nhà cung cấp." actions={<a className="w2-button w2-button-primary" href="/admin/refunds/new">Tạo yêu cầu hoàn</a>}><AsyncPanel value={remote} label="hoàn tiền" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Tham chiếu</th><th>Hóa đơn</th><th>Trạng thái</th><th>Đã yêu cầu</th><th>Đã hoàn tất</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.refundReference ?? row.id}</strong><small>{row.reasonCode}</small></td><td>{row.invoiceNumber ?? row.invoiceId}</td><td><Status value={row.status} /></td><td className="w2-money">{money(row.requestedMinor, row.currency)}</td><td className="w2-money">{money(row.completedMinor, row.currency)}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/refunds/${row.id}`}>Rà soát</a></td></tr>)}</tbody></table></div>}</Page>; }

function RefundDetail({ id }: { id: string }) { const value = useRemote(`/v1/refunds/${id}`); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const intents = useIntentKeys(); async function act(action: string, extra: any = {}) { if (!value.data) return; try { await command(`/v1/refunds/${id}/${action}`, { version: value.data.version, ...extra }, intents.key(action)); intents.clear(action); setMessage(`Đã thực hiện: ${action}.`); await value.load(); } catch (reason: any) { setError(reason.code === "VERSION_CONFLICT" ? "Yêu cầu vừa được cập nhật; dữ liệu đã được tải lại." : reason.message); await value.load(); } } return <Page title="Rà soát hoàn tiền" eyebrow="ĐIỀU CHỈNH · RÀ SOÁT" description="Kiểm tra dòng hóa đơn, phương thức thanh toán gốc và bằng chứng đảo trước khi thực hiện hoàn tiền." actions={<a className="w2-button w2-button-secondary" href="/admin/refunds">Quay lại danh sách</a>}><AsyncPanel value={value} label="hoàn tiền" />{value.state === "ready" && <><div className="w2-kpi-grid"><Kpi label="Đã yêu cầu" value={money(value.data.requestedMinor, value.data.currency)} emphasis /><Kpi label="Đã hoàn tất" value={money(value.data.completedMinor, value.data.currency)} /><Kpi label="Trạng thái" value={<Status value={value.data.status} />} /><Kpi label="Hóa đơn" value={value.data.invoiceNumber ?? legacyValue(value.data.invoiceId, "invoiceId")} /></div>{message && <div className="w2-notice w2-notice-success" role="status">{message}</div>}{error && <div className="w2-notice w2-notice-danger" role="alert">{error}</div>}<div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">BẰNG CHỨNG BẤT BIẾN</p><h2>Dòng hoàn và phương thức thanh toán gốc</h2></div><Status value={value.data.status} /></div><RefundEvidence data={value.data} /><div className="w2-actions"><button className="w2-button w2-button-secondary" onClick={() => void act("submit")}>Gửi duyệt</button><button className="w2-button w2-button-primary" onClick={() => void act("approve", { reason: "Evidence reviewed by manager" })}>Phê duyệt</button><button className="w2-button w2-button-danger" onClick={() => void act("reject", { reason: "Evidence requires correction" })}>Từ chối</button><button className="w2-button w2-button-secondary" onClick={() => void act("cancel", { reason: "Cancelled by operator" })}>Hủy</button></div></div></>}</Page>; }

function CreditNotes({ detailId }: { detailId?: string }) { const remote = useRemote(detailId ? `/v1/credit-notes/${detailId}` : "/v1/credit-notes"); const intents = useIntentKeys(); if (detailId) return <Page title="Chi tiết Credit Note" eyebrow="ĐIỀU CHỈNH · CREDIT NOTE" description="Credit Note là bằng chứng bất biến; việc phát hành và áp dụng được xử lý qua lệnh riêng." actions={<a className="w2-button w2-button-secondary" href="/admin/credit-notes">Quay lại Credit Note</a>}><AsyncPanel value={remote} label="Credit Note" />{remote.state === "ready" && <div className="w2-card"><div className="w2-card-head"><div><p className="w2-eyebrow">CREDIT NOTE</p><h2>{remote.data.creditNoteNumber ?? legacyValue(remote.data.id, "id")}</h2></div><Status value={remote.data.status} /></div><dl className="w2-totals"><div><dt>Hóa đơn</dt><dd>{remote.data.invoiceNumber ?? remote.data.context?.invoice?.number ?? legacyValue(remote.data.invoiceId, "invoiceId")}</dd></div><div><dt>Tổng tiền</dt><dd>{money(remote.data.totalMinor ?? remote.data.amountMinor, remote.data.currency)}</dd></div></dl><CreditNoteEvidence data={remote.data} /><button className="w2-button w2-button-secondary" onClick={() => { const intent = "deliver-credit-note"; void command(`/v1/credit-notes/${detailId}/deliver`, { channel: "PRINT" }, intents.key(intent)).then(() => intents.clear(intent)); }}>In chứng từ</button></div>}</Page>;
  return <Page title="Credit Note" eyebrow="ĐIỀU CHỈNH · CREDIT NOTE" description="Chứng từ Credit Note chỉ đọc và liên kết với hóa đơn cùng nguồn hoàn tiền. Mọi phát hành do luồng riêng xử lý."><AsyncPanel value={remote} label="Credit Note" />{remote.state === "ready" && <div className="w2-table-wrap"><table className="w2-table"><thead><tr><th>Credit Note</th><th>Hóa đơn</th><th>Trạng thái</th><th>Số tiền</th><th /></tr></thead><tbody>{(Array.isArray(remote.data) ? remote.data : []).map((row: any) => <tr key={row.id}><td><strong>{row.creditNoteNumber ?? row.id}</strong></td><td>{row.invoiceNumber ?? row.invoiceId}</td><td><Status value={row.status} /></td><td className="w2-money">{money(row.totalMinor ?? row.amountMinor, row.currency)}</td><td><a className="w2-button w2-button-secondary w2-button-small" href={`/admin/credit-notes/${row.id}`}>Mở bằng chứng</a></td></tr>)}</tbody></table></div>}</Page>;
}

function Commission({ adjustments = false }: { adjustments?: boolean }) {
  const remote = useRemote(adjustments ? "/v1/commission-adjustments" : "/v1/commission-entries");
  const records = Array.isArray(remote.data) ? remote.data : [];
  return (
    <Page
      title={adjustments ? "Điều chỉnh hoa hồng" : "Bằng chứng hoa hồng"}
      eyebrow="TÀI CHÍNH · HOA HỒNG"
      description={adjustments
        ? "Theo dõi các yêu cầu điều chỉnh theo quy trình phê duyệt hiện hành. Số tiền và trạng thái do máy chủ quyết định."
        : "Theo dõi khoản hoa hồng phát sinh, đảo do hoàn tiền và trạng thái ghi nhận từ dữ liệu tài chính bất biến."}
    >
      <section className="w2-toolbar" aria-label="Điều hướng hoa hồng">
        <a className="w2-button w2-button-secondary" href="/admin/commission">Tổng quan hoa hồng</a>
        <a className="w2-button w2-button-secondary" href="/admin/commission/entries">Bút toán hoa hồng</a>
        <a className="w2-button w2-button-secondary" href="/admin/commission/adjustments">Yêu cầu điều chỉnh</a>
        <a className="w2-button w2-button-secondary" href="/admin/commission/periods">Kỳ hoa hồng</a>
      </section>
      {remote.state === "ready" && (
        <section className="w2-kpi-grid" aria-label="Tóm tắt hoa hồng">
          <Kpi label={adjustments ? "Yêu cầu trong phạm vi" : "Bút toán trong phạm vi"} value={records.length} />
          <Kpi
            label={adjustments ? "Đang chờ xử lý" : "Đang phát sinh"}
            value={records.filter((row: any) => String(row.status ?? row.state).toUpperCase() === (adjustments ? "PENDING" : "OPEN")).length}
          />
          <Kpi
            label="Đơn vị tiền tệ"
            value={Array.from(new Set(records.map((row: any) => row.currency).filter(Boolean))).join(", ") || "—"}
          />
        </section>
      )}
      <AsyncPanel value={remote} label={adjustments ? "yêu cầu điều chỉnh" : "bút toán hoa hồng"} />
      {remote.state === "ready" && (
        records.length ? (
          <div className="w2-table-wrap">
            <table className="w2-table">
              <thead>
                <tr>
                  <th scope="col">Bản ghi</th>
                  <th scope="col">Nhân sự</th>
                  <th scope="col">Loại</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Số tiền</th>
                  <th scope="col">Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.entryReference ?? row.adjustmentReference ?? legacyValue(row.id, "id")}</strong>
                      <small>{row.ruleCode ?? row.reasonCode ?? "Theo dữ liệu máy chủ"}</small>
                    </td>
                    <td>{row.staffName ?? legacyValue(row.staffId, "staffId")}</td>
                    <td>{commissionEntryLabel(row.entryType ?? row.type ?? row.reasonCode)}</td>
                    <td><Status value={row.status ?? row.state} /></td>
                    <td className="w2-money">{money(row.amountMinor ?? row.commissionMinor ?? row.reversalMinor, row.currency)}</td>
                    <td>{row.sourceReference ?? legacyValue(row.refundId ?? row.statementId, "sourceId")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="w2-empty" role="status">
            Chưa có {adjustments ? "yêu cầu điều chỉnh" : "bút toán hoa hồng"} trong phạm vi hiện tại.
          </div>
        )
      )}
    </Page>
  );
}

function isWave2CommissionPath(pathname: string) {
  return (
    pathname === "/admin/commission" ||
    pathname === "/admin/commission/entries" ||
    pathname === "/admin/commission/adjustments"
  );
}

export function isWave2Path(pathname: string) {
  return (
    pathname === "/admin/pos" ||
    pathname === "/admin/pos/new" ||
    pathname.startsWith("/admin/pos/") ||
    pathname === "/admin/financial" ||
    pathname === "/admin/refunds" ||
    pathname.startsWith("/admin/refunds/") ||
    pathname === "/admin/credit-notes" ||
    pathname.startsWith("/admin/credit-notes/") ||
    isWave2CommissionPath(pathname)
  );
}

export default function Sprint19Wave2Screen({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/admin/pos" || pathname === "/admin/pos/") return <PosHome />;
  if (pathname === "/admin/financial" || pathname === "/admin/financial/") return <FinancialHome />;
  if (pathname === "/admin/pos/new") return <NewSale />;
  if (pathname.startsWith("/admin/pos/checkout/")) return <NewSale appointmentId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/orders") return <Orders />;
  if (pathname.endsWith("/payment") && pathname.startsWith("/admin/pos/orders/")) return <Payment orderId={parts[3] ?? ""} />;
  if (pathname.endsWith("/receipt") && pathname.startsWith("/admin/pos/orders/")) return <Receipt orderId={parts[3] ?? ""} />;
  if (pathname.startsWith("/admin/pos/orders/")) return <OrderWorkspace orderId={parts[3] ?? ""} />;
  if (pathname === "/admin/pos/registers") return <Registers />;
  if (pathname === "/admin/pos/cash-sessions/open") return <OpenRegister />;
  if (pathname === "/admin/pos/cash-sessions") return <CashSessions />;
  if (pathname.startsWith("/admin/pos/cash-sessions/")) return <CashSession sessionId={parts[3] ?? ""} close={pathname.endsWith("/close")} />;
  if (pathname === "/admin/financial/invoices") return <FinancialList kind="invoices" />;
  if (pathname === "/admin/financial/payments") return <FinancialList kind="payments" />;
  if (pathname === "/admin/financial/reconciliation") return <FinancialList kind="reconciliation" />;
  if (pathname === "/admin/financial/net-sales") return <FinancialList kind="net-sales" />;
  if (pathname === "/admin/refunds/new") return <RefundCreate />;
  if (pathname === "/admin/refunds") return <Refunds />;
  if (pathname.startsWith("/admin/refunds/")) return <RefundDetail id={parts[2] ?? ""} />;
  if (pathname === "/admin/credit-notes") return <CreditNotes />;
  if (pathname.startsWith("/admin/credit-notes/")) return <CreditNotes detailId={parts[2] ?? ""} />;
  if (pathname.startsWith("/admin/commission/adjustments")) return <Commission adjustments />;
  return <Commission />;
}
