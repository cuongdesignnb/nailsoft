"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Icon } from "@nailsoft/ui-web";
import { ACTIVE_BRANCH_CHANGED_EVENT, getAuthorizedBranchContext, getActiveBranchId } from "../auth";
import {
  BenefitShell,
  BenefitStatePanel,
  LedgerTable,
  formatDate,
  formatMoney,
  localized,
  rows,
  statusLabel,
  useBenefitMutation,
  useBenefitResource,
  benefitApi,
} from "./benefit-shared";
import styles from "./gift-card-hub.module.css";

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "s19-field s19-field-wide" : "s19-field"}><span>{label}</span>{children}</label>;
}

function productPayload(form: Record<string, string | boolean>) {
  return {
    productCode: String(form.productCode), name: { "vi-VN": String(form.name), "en-US": String(form.name) }, amountMode: String(form.amountMode), cardForm: String(form.cardForm), currency: String(form.currency).toUpperCase(),
    minimumAmountMinor: String(form.minimumAmountMinor), maximumAmountMinor: String(form.maximumAmountMinor), fixedDenominationsMinor: String(form.fixedDenominationsMinor).split(/[,\s]+/).map((value) => value.trim()).filter(Boolean), maximumBalanceMinor: String(form.maximumBalanceMinor), reloadable: Boolean(form.reloadable), assignmentPolicy: String(form.assignmentPolicy), pinRequired: Boolean(form.pinRequired),
    branchScope: {}, eligibilityPolicy: {}, refundPolicy: {}, replacementPolicy: {}, limitsPolicy: {},
  };
}

export function GiftCardProducts() {
  const resource = useBenefitResource("/v1/gift-card-products");
  const mutation = useBenefitMutation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({ productCode: "", name: "", amountMode: "OPEN", cardForm: "BOTH", currency: "VND", minimumAmountMinor: "0", maximumAmountMinor: "10000000", fixedDenominationsMinor: "", maximumBalanceMinor: "10000000", reloadable: true, assignmentPolicy: "BEARER_OR_CUSTOMER", pinRequired: true });
  const set = (key: string, value: string | boolean) => setForm((old) => ({ ...old, [key]: value }));
  async function submit(event: FormEvent) { event.preventDefault(); const value = await mutation.submit("/v1/gift-card-products", productPayload(form)); if (value !== undefined) { setShowForm(false); await resource.load(); } }
  async function activate(product: any) { const value = await mutation.submit(`/v1/gift-card-products/${product.id}/activate`, { version: product.version }); if (value !== undefined) await resource.load(); }
  const products = rows(resource.data);
  return <BenefitShell title="Gift card products" eyebrow="STORED VALUE · PRODUCTS" backHref="/admin/gift-cards"><div className="s19-card-heading"><div><p className="s19-helper">Configure sale products; issuance remains inside the POS funding flow.</p></div><button className="s19-button s19-button-primary" onClick={() => setShowForm((value) => !value)}>{showForm ? "Close form" : "Create product"}</button></div>{showForm && <form className="s19-card s19-benefit-form" onSubmit={(event) => void submit(event)}><div className="s19-form-grid"><Field label="Product code"><input required value={String(form.productCode)} onChange={(event) => set("productCode", event.target.value)} /></Field><Field label="Display name"><input required value={String(form.name)} onChange={(event) => set("name", event.target.value)} /></Field><Field label="Amount mode"><select value={String(form.amountMode)} onChange={(event) => set("amountMode", event.target.value)}><option value="OPEN">Open amount</option><option value="FIXED">Fixed denominations</option></select></Field><Field label="Card form"><select value={String(form.cardForm)} onChange={(event) => set("cardForm", event.target.value)}><option value="BOTH">Physical or digital</option><option value="PHYSICAL">Physical</option><option value="DIGITAL">Digital</option></select></Field><Field label="Currency"><input required maxLength={3} value={String(form.currency)} onChange={(event) => set("currency", event.target.value.toUpperCase())} /></Field><Field label="Minimum amount (minor units)"><input required value={String(form.minimumAmountMinor)} onChange={(event) => set("minimumAmountMinor", event.target.value)} /></Field><Field label="Maximum amount (minor units)"><input required value={String(form.maximumAmountMinor)} onChange={(event) => set("maximumAmountMinor", event.target.value)} /></Field><Field label="Maximum balance (minor units)"><input required value={String(form.maximumBalanceMinor)} onChange={(event) => set("maximumBalanceMinor", event.target.value)} /></Field><Field label="Fixed denominations (minor units, comma separated)" wide><input value={String(form.fixedDenominationsMinor)} onChange={(event) => set("fixedDenominationsMinor", event.target.value)} /></Field><Field label="Assignment policy"><select value={String(form.assignmentPolicy)} onChange={(event) => set("assignmentPolicy", event.target.value)}><option value="BEARER_OR_CUSTOMER">Bearer or customer</option><option value="CUSTOMER_REQUIRED">Customer required</option><option value="BEARER">Bearer</option></select></Field><Field label="Reloadable"><input type="checkbox" checked={Boolean(form.reloadable)} onChange={(event) => set("reloadable", event.target.checked)} /></Field><Field label="PIN required"><input type="checkbox" checked={Boolean(form.pinRequired)} onChange={(event) => set("pinRequired", event.target.checked)} /></Field></div><div className="s19-inline-actions"><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>{mutation.state === "submitting" ? "Saving…" : "Save draft"}</button>{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></form>}<BenefitStatePanel resource={resource} label="gift card products" />{resource.state === "ready" && <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">Gift card products</caption><thead><tr><th>Product</th><th>Amount</th><th>Form</th><th>Policy</th><th>Status</th><th>Action</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td data-label="Product"><strong>{product.productCode}</strong><small>{localized(product.name)}</small></td><td data-label="Amount">{formatMoney(product.minimumAmountMinor, product.currency)} – {formatMoney(product.maximumAmountMinor, product.currency)}</td><td data-label="Form">{statusLabel(product.cardForm)}</td><td data-label="Policy">{product.reloadable ? "Reloadable" : "Single load"}<small>{statusLabel(product.assignmentPolicy)}</small></td><td data-label="Status"><span className="s19-status s19-status-info">{statusLabel(product.status)}</span><small>v{product.version}</small></td><td data-label="Action">{product.status === "DRAFT" && <button className="s19-button s19-button-small" onClick={() => void activate(product)}>Activate</button>}</td></tr>)}</tbody></table></div>}</BenefitShell>;
}

export function GiftCardIssuance() {
  const products = useBenefitResource("/v1/gift-card-products");
  return <BenefitShell title="Gift card issuance" eyebrow="STORED VALUE · POS HANDOFF" backHref="/admin/gift-cards"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">SAFE ISSUANCE</p><h2>Start the gift-card sale in POS</h2></div><span className="s19-status s19-status-info">Capture required</span></div><p className="s19-helper">Gift cards are created only by the existing POS funding workflow after payment capture. This page does not create cards directly and never handles PIN or full card secrets.</p><div className="s19-inline-actions"><a className="s19-button s19-button-primary" href="/admin/pos/new">Start gift-card sale</a><a className="s19-button s19-button-secondary" href="/admin/gift-cards">View issued cards</a></div></section><section className="s19-card"><h2>Available products</h2><BenefitStatePanel resource={products} label="gift card products" />{products.state === "ready" && <div className="s19-benefit-stack">{rows(products.data).filter((product) => product.status === "ACTIVE").map((product) => <div className="s19-benefit-item" key={product.id}><div><strong>{product.productCode} · {localized(product.name)}</strong><span>{product.currency} · {statusLabel(product.cardForm)} · {product.reloadable ? "Reloadable" : "Single load"}</span></div><b>{formatMoney(product.minimumAmountMinor, product.currency)} – {formatMoney(product.maximumAmountMinor, product.currency)}</b></div>)}</div>}</section></BenefitShell>;
}

type GiftCardFilters = {
  search: string;
  branchId: string;
  productId: string;
  ownership: string;
  lifecycle: string;
  derivedState: string;
  balanceBucket: string;
  expiryWindowDays: number;
  inactiveDays: number;
  sort: string;
  page: number;
  pageSize: number;
};

const emptyGiftCardFilters: GiftCardFilters = {
  search: "",
  branchId: "",
  productId: "",
  ownership: "ALL",
  lifecycle: "ALL",
  derivedState: "ALL",
  balanceBucket: "ALL",
  expiryWindowDays: 30,
  inactiveDays: 90,
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
};

const lifecycleLabels: Record<string, string> = {
  PENDING_ACTIVATION: "Chờ kích hoạt",
  ACTIVE: "Còn hiệu lực",
  SUSPENDED: "Tạm khóa",
  DEPLETED: "Đã dùng hết",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã hủy",
  REPLACED: "Đã thay thế",
};
const derivedLabels: Record<string, string> = {
  UNUSED: "Chưa sử dụng",
  PARTIALLY_USED: "Đã dùng một phần",
  EXPIRING: "Sắp hết hạn",
  DORMANT_WITH_BALANCE: "Lâu chưa sử dụng",
  ACTIVE: "Khả dụng",
};

function labelForStatus(value: unknown) {
  const key = String(value ?? "");
  return lifecycleLabels[key] ?? derivedLabels[key] ?? key.replaceAll("_", " ");
}

const ledgerLabels: Record<string, string> = {
  ISSUE_PENDING: "Chờ kích hoạt",
  RELOAD_COMMIT: "Nạp thêm Gift Card",
  RESERVE: "Đang giữ cho giao dịch",
  RELEASE: "Giải phóng giao dịch",
  REDEEM: "Đã sử dụng Gift Card",
  REFUND_RESTORE: "Hoàn lại do Refund",
  REPLACEMENT_OUT: "Chuyển sang Gift Card thay thế",
  REPLACEMENT_IN: "Nhận giá trị từ Gift Card cũ",
  PURCHASE_CANCELLATION: "Hủy phát hành",
  EXPIRE: "Hết hạn số dư",
  CORRECTION: "Điều chỉnh theo chứng từ",
};

function ledgerLabel(value: unknown) {
  const key = String(value ?? "");
  return ledgerLabels[key] ?? labelForStatus(key);
}

function readGiftCardFilters(): GiftCardFilters {
  if (typeof window === "undefined") return emptyGiftCardFilters;
  const params = new URLSearchParams(window.location.search);
  const value = { ...emptyGiftCardFilters };
  for (const key of Object.keys(value) as Array<keyof GiftCardFilters>) {
    const raw = params.get(key);
    if (raw == null) continue;
    if (["page", "pageSize", "expiryWindowDays", "inactiveDays"].includes(key)) (value[key] as number) = Number(raw) || Number(value[key]);
    else (value[key] as string) = raw;
  }
  if (!value.branchId) value.branchId = getActiveBranchId() ?? "";
  return value;
}

function giftCardQuery(filters: GiftCardFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === "ALL" || (key === "page" && value === 1) || (key === "pageSize" && value === 10)) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function amountForCurrency(entries: any[], empty = "—") {
  if (!Array.isArray(entries) || entries.length === 0) return empty;
  if (entries.length > 1) return `${entries.length} loại tiền`;
  return formatMoney(entries[0]?.amountMinor, entries[0]?.currency);
}

function safeMoney(value: unknown, currency: string, permitted: boolean) {
  if (!permitted || value == null) return "Không có quyền xem";
  return formatMoney(value, currency);
}

function shortDate(value: unknown) {
  if (!value) return "Không hết hạn";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(String(value)));
}

function CardState({ card }: { card: any }) {
  return <span className={`${styles.badge} ${styles[`badge_${String(card.derivedState ?? card.status)}`] ?? ""}`}>{labelForStatus(card.derivedState ?? card.status)}</span>;
}

function Kpi({ icon, tone, label, value, detail }: { icon: string; tone: string; label: string; value: string; detail: string }) {
  return <article className={`${styles.kpi} ${styles[`kpi_${tone}`]}`}><span className={styles.kpiIcon}><Icon name={icon as any} /></span><div><span className={styles.kpiLabel}>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function GiftCardLookup({ open, onClose, onFound }: { open: boolean; onClose: () => void; onFound: (id: string) => void }) {
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  if (!open) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("submitting"); setMessage("");
    try {
      const value = await benefitApi("/v1/gift-cards/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number, ...(pin ? { pin } : {}) }) });
      const id = value?.id;
      setNumber(""); setPin("");
      if (id) { onClose(); onFound(String(id)); }
      else { setState("error"); setMessage("Không tìm thấy Gift Card phù hợp."); }
    } catch (error: any) {
      setNumber(""); setPin(""); setState("error"); setMessage(error?.message ?? "Không thể tra cứu Gift Card.");
    }
  }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="gift-card-lookup-title"><button className={styles.modalClose} type="button" onClick={onClose} aria-label="Đóng tra cứu">×</button><span className={styles.eyebrow}>TRA CỨU BẢO MẬT</span><h2 id="gift-card-lookup-title">Tra cứu Gift Card</h2><p>Thông tin số thẻ và PIN chỉ được gửi tới endpoint tra cứu bảo mật, không lưu vào URL hoặc bộ nhớ trình duyệt.</p><form onSubmit={(event) => void submit(event)}><label>Số Gift Card<input autoFocus required value={number} onChange={(event) => setNumber(event.target.value)} autoComplete="off" /></label><label>PIN nếu chính sách yêu cầu<input type="password" value={pin} onChange={(event) => setPin(event.target.value)} autoComplete="off" /></label>{message ? <div className={styles.error} role="alert">{message}</div> : null}<div className={styles.modalActions}><button className={styles.buttonQuiet} type="button" onClick={onClose}>Hủy</button><button className={styles.buttonPrimary} type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Đang tra cứu…" : "Tra cứu"}</button></div></form></div></div>;
}

export function GiftCards() {
  const [filters, setFilters] = useState<GiftCardFilters>(readGiftCardFilters);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("giftCardId") ?? undefined);
  const [branches, setBranches] = useState<any[]>([]);
  const [exportMessage, setExportMessage] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  const query = useMemo(() => giftCardQuery(filters), [filters]);
  const directory = useBenefitResource(`/v1/gift-cards/directory${query ? `?${query}` : ""}`);
  const products = useBenefitResource("/v1/gift-card-products");
  const selected = useBenefitResource(selectedId ? `/v1/gift-cards/${encodeURIComponent(selectedId)}/overview` : null);
  const mutation = useBenefitMutation();
  const data = directory.data ?? {};
  const items = rows(data);
  const summary = data.summary ?? {};
  const total = Number(data.pagination?.total ?? 0);
  const totalPages = Number(data.pagination?.totalPages ?? 0);
  const directoryReady = directory.state === "ready";
  const balanceAccess = directoryReady && data.access?.balance !== false;
  const summaryAmount = (entries: any[], empty = "—") => directoryReady ? amountForCurrency(entries, balanceAccess ? empty : "Không có quyền xem") : "—";

  useEffect(() => {
    let alive = true;
    void getAuthorizedBranchContext().then((result) => { if (alive) setBranches(result.branches); }).catch(() => undefined);
    const onBranchChange = () => setFilters((old) => ({ ...old, branchId: getActiveBranchId() ?? "", page: 1 }));
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { alive = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, []);
  useEffect(() => {
    if (!selectedId && directory.state === "ready" && items[0]?.id) setSelectedId(String(items[0].id));
  }, [directory.state, items, selectedId]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const next = new URLSearchParams(query);
      if (selectedId) next.set("giftCardId", selectedId); else next.delete("giftCardId");
      window.history.replaceState(null, "", `${window.location.pathname}${next.toString() ? `?${next}` : ""}`);
    }
  }, [query, selectedId]);
  useEffect(() => {
    document.querySelector(`.${styles.pagination} select`)?.setAttribute("aria-label", "Số dòng mỗi trang");
  }, [directory.state, total]);

  function update(key: keyof GiftCardFilters, value: string | number) {
    setFilters((old) => ({ ...old, [key]: value, ...(key === "page" ? {} : { page: 1 }) }));
  }
  function selectCard(id: string) { setSelectedId(id); }
  async function requestExport() {
    setExportMessage("Đang tạo file xuất…");
    try {
      await benefitApi("/v1/stored-value/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ exportType: "LIABILITY", filters: { domain: "GIFT_CARD", ...filters } }) });
      setExportMessage("Đã tạo yêu cầu xuất dữ liệu.");
    } catch (error: any) { setExportMessage(error?.message ?? "Không thể tạo yêu cầu xuất dữ liệu."); }
  }
  async function command(action: "suspend" | "reactivate" | "cancel" | "replace") {
    const current = selected.data;
    const version = current?.card?.version;
    if (!version || !selectedId) return;
    const reason = action === "replace" ? window.prompt("Lý do thay Gift Card") : action === "suspend" ? "ADMIN_REVIEW" : action === "reactivate" ? "REVIEW_COMPLETE" : "CUSTOMER_REQUEST";
    if (action === "replace" && !reason) return;
    const value = await mutation.submit(`/v1/gift-cards/${selectedId}/${action}`, { version, reason: reason ?? "ADMIN_REVIEW" });
    if (value !== undefined) { await Promise.all([selected.load(), directory.load()]); }
  }
  const selectedOverview = selected.data;
  const selectedCustomerId = selectedOverview?.customer?.id;
  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><p className={styles.breadcrumb}><span>Khách hàng</span><b>/</b> Gift Card</p><h1 aria-label="Gift cards">Gift Card</h1><p className={styles.subtitle}>Theo dõi Gift Card đã phát hành, số dư, lịch sử sử dụng và chứng từ liên quan của khách hàng.</p></div><div className={styles.headerActions}><button className={styles.buttonQuiet} type="button" onClick={() => void requestExport()}><Icon name="download" /> Xuất báo cáo</button><button className={styles.buttonQuiet} type="button" onClick={() => setLookupOpen(true)}><Icon name="search" /> Tra cứu Gift Card</button>{data.access?.issue !== false ? <a className={styles.buttonPrimary} href="/admin/gift-cards/issuance"><Icon name="plus" /> Phát hành Gift Card</a> : null}</div></header>
    {exportMessage ? <p className={styles.inlineMessage} role="status">{exportMessage}</p> : null}
    <section className={styles.kpiGrid} aria-label="Tổng quan Gift Card"><Kpi icon="gift" tone="pink" label="Gift Card đang hoạt động" value={directoryReady && balanceAccess ? String(summary.activeCount ?? 0) : "—"} detail={directoryReady ? `${summary.activeCustomerCount ?? 0} khách hàng` : "Đang tải dữ liệu"} /><Kpi icon="wallet" tone="blue" label="Tổng số dư khả dụng" value={summaryAmount(summary.availableByCurrency)} detail="Theo số dư server" /><Kpi icon="chart" tone="purple" label="Đã sử dụng tháng này" value={summaryAmount(summary.redeemedThisPeriodByCurrency)} detail={directoryReady ? `${summary.redeemedThisPeriodTransactionCount ?? 0} giao dịch` : "Đang tải dữ liệu"} /><Kpi icon="calendar" tone="green" label="Phát hành tháng này" value={directoryReady && balanceAccess ? String(summary.activatedThisPeriodCount ?? 0) : "—"} detail={directoryReady ? summaryAmount(summary.activatedFaceValueByCurrency, "Chưa có dữ liệu") : "Đang tải dữ liệu"} /><Kpi icon="clock" tone="amber" label="Sắp hết hạn" value={directoryReady ? String(summary.expiringCount ?? 0) : "—"} detail={`Trong ${filters.expiryWindowDays} ngày tới`} /><Kpi icon="notification" tone="coral" label="Lâu chưa sử dụng" value={directoryReady ? String(summary.dormantWithBalanceCount ?? 0) : "—"} detail={`Không hoạt động trên ${filters.inactiveDays} ngày`} /></section>
    <section className={styles.healthCard}><div className={styles.sectionHeading}><div><h2>Tình trạng Gift Card</h2><p>Nhóm trạng thái được tính từ lifecycle và ledger thật.</p></div><span className={styles.healthLegend}>Server read model</span></div><div className={styles.healthBar}>{Object.entries(data.lifecycleDistribution ?? {}).map(([key, value]: [string, any]) => <span key={key} className={`${styles.healthSegment} ${styles[`segment_${key}`] ?? ""}`} style={{ flex: Math.max(1, Number(value)) }} title={`${labelForStatus(key)}: ${value}`} />)}</div><div className={styles.healthLabels}>{Object.entries(data.lifecycleDistribution ?? {}).map(([key, value]: [string, any]) => <span key={key}><b>{Number(value)}</b><small>{labelForStatus(key)}</small></span>)}</div></section>
    <section className={styles.filterCard}><div className={styles.filterGrid}><label className={styles.search}><Icon name="search" /><span>Tìm mã Gift Card / khách hàng / SĐT / hóa đơn…</span><input value={filters.search} onChange={(event) => update("search", event.target.value)} aria-label="Tìm Gift Card" /></label><label>Chi nhánh<select value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả chi nhánh trong phạm vi</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Gift Card Product<select value={filters.productId} onChange={(event) => update("productId", event.target.value)}><option value="">Tất cả sản phẩm</option>{rows(products.data).map((product) => <option key={product.id} value={product.id}>{localized(product.name, product.productCode)}</option>)}</select></label><label>Khách hàng<select value={filters.ownership} onChange={(event) => update("ownership", event.target.value)}><option value="ALL">Tất cả</option><option value="CUSTOMER_ASSIGNED">Đã gán khách hàng</option><option value="BEARER">Bearer / chưa gán</option></select></label><label>Trạng thái<select value={filters.lifecycle} onChange={(event) => update("lifecycle", event.target.value)}><option value="ALL">Tất cả</option>{Object.entries(lifecycleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><div className={styles.filterFooter}><div className={styles.chips}><button className={filters.derivedState === "ALL" && filters.balanceBucket === "ALL" ? styles.chipActive : styles.chip} type="button" onClick={() => setFilters((old) => ({ ...old, derivedState: "ALL", balanceBucket: "ALL", page: 1 }))}>Tất cả</button><button className={filters.balanceBucket === "GT_1000000" ? styles.chipActive : styles.chip} type="button" onClick={() => update("balanceBucket", "GT_1000000")}>Có số dư lớn</button><button className={filters.derivedState === "PARTIALLY_USED" ? styles.chipActive : styles.chip} type="button" onClick={() => update("derivedState", "PARTIALLY_USED")}>Đã dùng một phần</button><button className={filters.derivedState === "EXPIRING" ? styles.chipActive : styles.chip} type="button" onClick={() => update("derivedState", "EXPIRING")}>Sắp hết hạn</button><button className={filters.derivedState === "DORMANT_WITH_BALANCE" ? styles.chipActive : styles.chip} type="button" onClick={() => update("derivedState", "DORMANT_WITH_BALANCE")}>Lâu chưa sử dụng</button><button className={filters.lifecycle === "SUSPENDED" ? styles.chipActive : styles.chip} type="button" onClick={() => update("lifecycle", "SUSPENDED")}>Tạm khóa</button></div><div className={styles.filterTools}><label>Sắp xếp<select value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="BALANCE_DESC">Số dư cao nhất</option><option value="EXPIRY_ASC">Sắp hết hạn trước</option><option value="LAST_ACTIVITY_ASC">Lâu chưa hoạt động</option></select></label><button className={styles.buttonQuiet} type="button" onClick={() => setFilters({ ...emptyGiftCardFilters, branchId: getActiveBranchId() ?? "" })}>Xóa bộ lọc</button></div></div></section>
    <div className={styles.workspace}>
      <section className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <div><h2>Danh sách Gift Card</h2><span>{total} Gift Card trong phạm vi truy cập</span></div>
          <a className={styles.textLink} href="/admin/gift-cards/products">Quản lý sản phẩm</a>
        </div>
        {directory.state === "loading" ? <div className={styles.loading} role="status">Đang tải danh sách Gift Card…</div> : null}
        {directory.state === "forbidden" ? <div className={styles.empty} role="alert"><strong>Bạn không có quyền xem Gift Card.</strong></div> : null}
        {directory.state === "error" ? <div className={styles.error} role="alert">{directory.error}<button type="button" onClick={() => void directory.load()}>Thử lại</button></div> : null}
        {directory.state === "ready" && items.length === 0 ? <div className={styles.empty}><Icon name="gift" /><strong>Chưa có Gift Card phù hợp</strong><span>Thử xóa bộ lọc hoặc tra cứu Gift Card bằng luồng bảo mật.</span><button type="button" onClick={() => setLookupOpen(true)}>Tra cứu Gift Card</button></div> : null}
        {directory.state === "ready" && items.length > 0 ? <div className={styles.tableScroll}>
          <table>
            <caption className={styles.srOnly}>Danh sách Gift Card</caption>
            <thead><tr><th scope="col">Gift Card</th><th scope="col">Khách hàng</th><th scope="col">Giá trị ban đầu</th><th scope="col">Đã nạp thêm</th><th scope="col">Đã sử dụng</th><th scope="col">Số dư</th><th scope="col">Ngày kích hoạt</th><th scope="col">Hết hạn</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead>
            <tbody>{items.map((card: any) => <tr key={card.id} className={selectedId === card.id ? styles.selectedRow : ""} aria-selected={selectedId === card.id}>
              <td><button className={styles.cardButton} type="button" onClick={() => selectCard(String(card.id))}><strong>{card.cardReference}</strong><small>{card.maskedNumber} · {card.form === "DIGITAL" ? "Digital" : card.form === "PHYSICAL" ? "Physical" : card.form}</small></button></td>
              <td>{card.customer ? <><strong>{card.customer.displayName}</strong><small>Khách hàng được gán</small></> : <><strong>Không gán khách hàng</strong><small>Bearer</small></>}</td>
              <td>{safeMoney(card.initialFaceValueMinor, card.currency, Boolean(card.access?.balance && balanceAccess))}</td>
              <td>{safeMoney(card.reloadCommittedMinor, card.currency, Boolean(card.access?.balance && balanceAccess))}</td>
              <td>{safeMoney(card.netRedeemedMinor, card.currency, Boolean(card.access?.balance && balanceAccess))}</td>
              <td><strong>{safeMoney(card.availableMinor, card.currency, Boolean(card.access?.balance && balanceAccess))}</strong>{card.reservedMinor && card.reservedMinor !== "0" ? <small>Đang giữ {formatMoney(card.reservedMinor, card.currency)}</small> : null}</td>
              <td>{card.activatedAt ? shortDate(card.activatedAt) : "Chờ kích hoạt"}</td><td>{shortDate(card.expiresAt)}</td>
              <td><CardState card={card} /><small>{labelForStatus(card.status)}</small></td>
              <td><button className={styles.rowAction} type="button" onClick={() => selectCard(String(card.id))}>Xem chi tiết <Icon name="arrowRight" /></button></td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {directory.state === "ready" && total > 0 ? <div className={styles.pagination}><span>Hiển thị {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, total)} trong {total} Gift Card</span><div><button type="button" disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)}>‹</button><b>{filters.page} / {Math.max(totalPages, 1)}</b><button type="button" disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)}>›</button><select value={filters.pageSize} onChange={(event) => update("pageSize", Number(event.target.value))}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div> : null}
      </section>
      <aside className={styles.rail} aria-label="Chi tiết Gift Card">
        {selectedOverview ? <>
          <section className={styles.railCard}><div className={styles.railHeading}><div><span className={styles.eyebrow}>CHI TIẾT GIFT CARD</span><h2>{selectedOverview.card.cardReference}</h2></div><span className={styles.statusPill}>{labelForStatus(selectedOverview.card.status)}</span></div><p className={styles.masked}>{selectedOverview.card.maskedNumber}</p><div className={styles.preview}><span>NAILSOFT</span><strong>GIFT CARD</strong><b>{selectedOverview.balance ? safeMoney(selectedOverview.balance.availableMinor, selectedOverview.card.currency, true) : "Không có quyền xem số dư"}</b><small>{selectedOverview.card.cardReference}</small></div><div className={styles.owner}>{selectedOverview.customer ? <><span className={styles.avatar}>{String(selectedOverview.customer.displayName).slice(0, 1).toUpperCase()}</span><div><strong>{selectedOverview.customer.displayName}</strong><small>Khách hàng được gán</small></div><a href={`/admin/customers/${selectedCustomerId}`}>Mở hồ sơ</a></> : <><span className={styles.avatar}>B</span><div><strong>Không gán khách hàng</strong><small>Bearer theo chính sách sản phẩm</small></div></>}</div></section>
          <section className={styles.railCard}><h2>Số dư Gift Card</h2>{selectedOverview.balance ? <dl className={styles.detailList}><div><dt>Giá trị phát hành ban đầu</dt><dd>{formatMoney(selectedOverview.balance.initialFaceValueMinor, selectedOverview.card.currency)}</dd></div><div><dt>Đã nạp thêm</dt><dd>{formatMoney(selectedOverview.balance.reloadCommittedMinor, selectedOverview.card.currency)}</dd></div><div><dt>Đã sử dụng ròng</dt><dd>{formatMoney(selectedOverview.balance.netRedeemedMinor, selectedOverview.card.currency)}</dd></div><div><dt>Đang giữ</dt><dd>{formatMoney(selectedOverview.balance.reservedMinor, selectedOverview.card.currency)}</dd></div><div className={styles.emphasis}><dt>Số dư khả dụng</dt><dd>{formatMoney(selectedOverview.balance.availableMinor, selectedOverview.card.currency)}</dd></div><div><dt>Giá trị nghĩa vụ còn lại</dt><dd>{formatMoney(selectedOverview.balance.liabilityMinor, selectedOverview.card.currency)}</dd></div></dl> : <p className={styles.restricted}>Bạn không có quyền xem số dư Gift Card.</p>}</section>
          <section className={styles.railCard}><h2>Thông tin phát hành</h2><dl className={styles.detailList}><div><dt>Ngày kích hoạt</dt><dd>{shortDate(selectedOverview.card.activatedAt)}</dd></div><div><dt>Hết hạn</dt><dd>{shortDate(selectedOverview.card.expiresAt)}</dd></div><div><dt>Chi nhánh phát hành</dt><dd>{selectedOverview.source?.issuanceBranchName ?? "—"}</dd></div><div><dt>Sản phẩm</dt><dd>{localized(selectedOverview.product?.name, selectedOverview.product?.productCode)}</dd></div><div><dt>POS nguồn</dt><dd>{selectedOverview.source?.sourceOrderNumber ?? "—"}</dd></div><div><dt>Payment funding</dt><dd>{selectedOverview.source?.paymentReference ?? "—"}</dd></div></dl>{selectedOverview.card.lockedUntil ? <p className={styles.warning}>Tạm khóa xác thực đến {formatDate(selectedOverview.card.lockedUntil)}</p> : null}</section>
          <section className={styles.railCard}><h2>Thao tác</h2><div className={styles.actionStack}>{selectedOverview.access?.actions?.suspend ? <button type="button" onClick={() => void command("suspend")}>Tạm khóa Gift Card</button> : null}{selectedOverview.access?.actions?.reactivate ? <button type="button" onClick={() => void command("reactivate")}>Kích hoạt lại</button> : null}{selectedOverview.access?.actions?.replace ? <button type="button" onClick={() => void command("replace")}>Thay Gift Card</button> : null}{selectedOverview.access?.actions?.cancel ? <button type="button" onClick={() => void command("cancel")}>Hủy Gift Card</button> : null}{selectedOverview.access?.actions?.reload ? <a href="/admin/pos/new">Nạp thêm qua POS</a> : null}{selectedOverview.source?.sourceOrderId ? <a href={`/admin/pos/orders/${selectedOverview.source.sourceOrderId}`}>Mở POS nguồn</a> : null}</div>{mutation.message ? <p className={mutation.state === "error" ? styles.error : styles.success} role="status">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</p> : null}</section>
          <section className={styles.railCard}><div className={styles.railHeading}><h2>Lịch sử số dư gần đây</h2>{selectedOverview.access?.ledger ? <a href={`/admin/gift-cards/${selectedId}`}>Xem đầy đủ</a> : null}</div>{selectedOverview.access?.ledger ? <div className={styles.miniLedger}>{(selectedOverview.recentLedger ?? []).map((entry: any) => <div key={entry.id}><span className={styles.ledgerDot} /><div><strong>{ledgerLabel(entry.entryType)}</strong><small>{formatDate(entry.occurredAt)}</small></div><b>{entry.availableDeltaMinor && entry.availableDeltaMinor !== "0" ? formatMoney(entry.availableDeltaMinor, selectedOverview.card.currency) : "—"}</b></div>)}</div> : <p className={styles.restricted}>Bạn không có quyền xem lịch sử số dư.</p>}</section>
        </> : <section className={styles.railCard}><div className={styles.empty}><Icon name="gift" /><strong>Chọn một Gift Card</strong><span>Chọn một dòng để xem chi tiết server.</span></div></section>}
      </aside>
    </div>
    <GiftCardLookup open={lookupOpen} onClose={() => setLookupOpen(false)} onFound={selectCard} />
  </main>;
}

export function GiftCardDetailLegacy({ giftCardId }: { giftCardId: string }) {
  const card = useBenefitResource(`/v1/gift-cards/${encodeURIComponent(giftCardId)}`);
  const balance = useBenefitResource(`/v1/gift-cards/${encodeURIComponent(giftCardId)}/balance`);
  const ledger = useBenefitResource(`/v1/gift-cards/${encodeURIComponent(giftCardId)}/ledger`);
  const mutation = useBenefitMutation();
  const current = card.data;
  async function command(action: "suspend" | "reactivate") { const value = await mutation.submit(`/v1/gift-cards/${giftCardId}/${action}`, { version: current?.version, reason: action === "suspend" ? "ADMIN_REVIEW" : "REVIEW_COMPLETE" }); if (value !== undefined) await Promise.all([card.load(), balance.load(), ledger.load()]); }
  return <BenefitShell title="Gift card detail" eyebrow="STORED VALUE · MASKED DETAIL" backHref="/admin/gift-cards"><BenefitStatePanel resource={card} label="gift card" />{current && <><section className="s19-benefit-customer-header"><div><p className="s19-eyebrow">MASKED CARD</p><h2>{current.cardReference || current.maskedNumber || "Masked card"}</h2><p>{current.maskedNumber || "Full card number and PIN are never displayed."}</p></div><span className="s19-status s19-status-info">{statusLabel(current.status)}</span></section><div className="s19-benefit-grid"><section className="s19-card"><h2>Authoritative balance</h2><BenefitStatePanel resource={balance} label="gift card balance" />{balance.state === "ready" && <dl className="s19-benefit-detail-list"><div><dt>Available</dt><dd>{formatMoney(balance.data?.availableMinor ?? current.balance?.availableMinor, current.currency)}</dd></div><div><dt>Reserved</dt><dd>{formatMoney(balance.data?.reservedMinor ?? current.balance?.reservedMinor, current.currency)}</dd></div><div><dt>Redeemed</dt><dd>{formatMoney(balance.data?.redeemedMinor ?? current.balance?.redeemedMinor, current.currency)}</dd></div><div><dt>Currency</dt><dd>{current.currency}</dd></div></dl>}</section><section className="s19-card"><h2>Lifecycle</h2><dl className="s19-benefit-detail-list"><div><dt>Form</dt><dd>{statusLabel(current.form)}</dd></div><div><dt>Activated</dt><dd>{formatDate(current.activatedAt)}</dd></div><div><dt>Expires</dt><dd>{formatDate(current.expiresAt)}</dd></div><div><dt>Version</dt><dd>{current.version}</dd></div></dl><div className="s19-inline-actions">{current.status === "ACTIVE" && <button className="s19-button s19-button-secondary" onClick={() => void command("suspend")}>Suspend</button>}{current.status === "SUSPENDED" && <button className="s19-button s19-button-primary" onClick={() => void command("reactivate")}>Reactivate</button>}{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></section></div><section className="s19-card"><h2>Append-only ledger</h2><BenefitStatePanel resource={ledger} label="gift card ledger" />{ledger.state === "ready" && <LedgerTable entries={rows(ledger.data)} emptyLabel="gift card ledger entries" />}</section></>}</BenefitShell>;
}

export function GiftCardDetail({ giftCardId }: { giftCardId: string }) {
  const overview = useBenefitResource(`/v1/gift-cards/${encodeURIComponent(giftCardId)}/overview`);
  const ledger = useBenefitResource(`/v1/gift-cards/${encodeURIComponent(giftCardId)}/ledger/directory?page=1&pageSize=20&sort=NEWEST`);
  const mutation = useBenefitMutation();
  const data = overview.data;
  const card = data?.card;
  const balance = data?.balance;
  const entries = rows(ledger.data);

  async function command(action: "suspend" | "reactivate" | "cancel" | "replace") {
    if (!card) return;
    const reason = action === "replace" ? window.prompt("Lý do thay Gift Card", "Thay thẻ theo yêu cầu khách hàng") : action === "cancel" ? window.prompt("Lý do hủy Gift Card", "Hủy theo yêu cầu vận hành") : action === "suspend" ? "ADMIN_REVIEW" : "REVIEW_COMPLETE";
    if (reason === null) return;
    const value = await mutation.submit(`/v1/gift-cards/${encodeURIComponent(giftCardId)}/${action}`, { version: card.version, reason });
    if (value !== undefined) await Promise.all([overview.load(), ledger.load()]);
  }

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div><p className={styles.breadcrumb}><a href="/admin/gift-cards">Khách hàng</a><b>/</b> Gift Card <b>/</b> Chi tiết</p><h1>Chi tiết Gift Card</h1><p className={styles.subtitle}>Theo dõi số dư server, nguồn phát hành, chính sách và lịch sử biến động của Gift Card.</p></div>
      <div className={styles.headerActions}><a className={styles.buttonQuiet} href="/admin/gift-cards"><Icon name="arrowLeft" /> Danh sách Gift Card</a>{card?.access?.actions?.reload ? <a className={styles.buttonPrimary} href="/admin/pos/new"><Icon name="plus" /> Nạp thêm qua POS</a> : null}</div>
    </header>
    {overview.state === "loading" ? <section className={styles.loading} role="status">Đang tải chi tiết Gift Card…</section> : null}
    {overview.state === "error" ? <section className={styles.error} role="alert">{overview.error}<button type="button" onClick={() => void overview.load()}>Thử lại</button></section> : null}
    {card ? <div className={`${styles.workspace} gift-card-detail-workspace`}>
      <div className={`${styles.rail} gift-card-detail-rail`}>
        <section className={styles.railCard}><div className={styles.railHeading}><div><span className={styles.eyebrow}>CHI TIẾT GIFT CARD</span><h2>{card.cardReference}</h2></div><span className={styles.statusPill}>{labelForStatus(card.status)}</span></div><p className={styles.masked}>{card.maskedNumber}</p><div className={styles.preview}><span>NAILSOFT</span><strong>GIFT CARD</strong><b>{balance ? safeMoney(balance.availableMinor, card.currency, true) : "Không có quyền xem số dư"}</b><small>{card.cardReference}</small></div><div className={styles.owner}>{data.customer ? <><span className={styles.avatar}>{String(data.customer.displayName).slice(0, 1).toUpperCase()}</span><div><strong>{data.customer.displayName}</strong><small>Khách hàng được gán</small></div><a href={`/admin/customers/${data.customer.id}`}>Mở hồ sơ</a></> : <><span className={styles.avatar}>B</span><div><strong>Không gán khách hàng</strong><small>Bearer theo chính sách sản phẩm</small></div></>}</div></section>
        <section className={styles.railCard}><h2>Số dư Gift Card</h2>{balance ? <dl className={styles.detailList}><div><dt>Giá trị phát hành ban đầu</dt><dd>{formatMoney(balance.initialFaceValueMinor, card.currency)}</dd></div><div><dt>Đã nạp thêm</dt><dd>{formatMoney(balance.reloadCommittedMinor, card.currency)}</dd></div><div><dt>Đã sử dụng ròng</dt><dd>{formatMoney(balance.netRedeemedMinor, card.currency)}</dd></div><div><dt>Đang giữ</dt><dd>{formatMoney(balance.reservedMinor, card.currency)}</dd></div><div className={styles.emphasis}><dt>Số dư khả dụng</dt><dd>{formatMoney(balance.availableMinor, card.currency)}</dd></div><div><dt>Giá trị nghĩa vụ còn lại</dt><dd>{formatMoney(balance.liabilityMinor, card.currency)}</dd></div></dl> : <p className={styles.restricted}>Bạn không có quyền xem số dư Gift Card.</p>}</section>
        <section className={styles.railCard}><h2>Thông tin phát hành</h2><dl className={styles.detailList}><div><dt>Ngày kích hoạt</dt><dd>{shortDate(card.activatedAt)}</dd></div><div><dt>Hết hạn</dt><dd>{shortDate(card.expiresAt)}</dd></div><div><dt>Chi nhánh phát hành</dt><dd>{data.source?.issuanceBranchName ?? "—"}</dd></div><div><dt>Sản phẩm</dt><dd>{localized(data.product?.name, data.product?.productCode)}</dd></div><div><dt>POS nguồn</dt><dd>{data.source?.sourceOrderNumber ?? "—"}</dd></div><div><dt>Payment funding</dt><dd>{data.source?.paymentReference ?? "—"}</dd></div><div><dt>Chính sách thời hạn</dt><dd>{data.policy?.expirationMode ?? "—"}</dd></div></dl>{card.lockedUntil ? <p className={styles.warning}>Tạm khóa xác thực đến {formatDate(card.lockedUntil)}</p> : null}</section>
        <section className={styles.railCard}><h2>Thao tác</h2><div className={styles.actionStack}>{data.access?.actions?.suspend ? <button type="button" onClick={() => void command("suspend")}>Tạm khóa Gift Card</button> : null}{data.access?.actions?.reactivate ? <button type="button" onClick={() => void command("reactivate")}>Kích hoạt lại</button> : null}{data.access?.actions?.replace ? <button type="button" onClick={() => void command("replace")}>Thay Gift Card</button> : null}{data.access?.actions?.cancel ? <button type="button" onClick={() => void command("cancel")}>Hủy Gift Card</button> : null}{data.source?.sourceOrderId ? <a href={`/admin/pos/orders/${data.source.sourceOrderId}`}>Mở POS nguồn</a> : null}</div>{mutation.message ? <p className={mutation.state === "error" ? styles.error : styles.success} role="status">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</p> : null}</section>
      </div>
      <section className={`${styles.tableCard} gift-card-detail-main`}><div className={styles.tableHeader}><div><span className={styles.eyebrow}>LEDGER SERVER-SIDE</span><h2>Lịch sử số dư</h2><p>Running balance được tính trên toàn bộ chronology, không theo riêng trang hiện tại.</p></div></div>{!data.access?.ledger ? <p className={styles.restricted}>Bạn không có quyền xem lịch sử số dư.</p> : ledger.state === "loading" ? <div className={styles.loading}>Đang tải lịch sử số dư…</div> : ledger.state === "error" ? <div className={styles.error} role="alert">{ledger.error}</div> : <div className={styles.tableScroll}><table className="s19-benefit-table"><caption className={styles.srOnly}>Lịch sử số dư Gift Card</caption><thead><tr><th scope="col">Thời gian</th><th scope="col">Loại</th><th scope="col">Chứng từ</th><th scope="col">Thay đổi khả dụng</th><th scope="col">Số dư sau</th><th scope="col">Đang giữ sau</th><th scope="col">Người thực hiện</th></tr></thead><tbody>{entries.map((entry: any) => <tr key={entry.id}><td>{formatDate(entry.occurredAt)}</td><td><strong>{ledgerLabel(entry.entryType)}</strong></td><td>{entry.orderNumber ?? entry.invoiceNumber ?? entry.paymentReference ?? entry.refundReference ?? entry.creditNoteNumber ?? "—"}</td><td>{entry.availableDeltaMinor && entry.availableDeltaMinor !== "0" ? formatMoney(entry.availableDeltaMinor, card.currency) : "—"}</td><td>{formatMoney(entry.availableAfterMinor, card.currency)}</td><td>{formatMoney(entry.reservedAfterMinor, card.currency)}</td><td>{entry.actorDisplayName ?? "Hệ thống"}</td></tr>)}</tbody></table></div>}</section>
    </div> : null}
  </main>;
}
