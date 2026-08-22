/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "../../auth";
import styles from "./customer-benefits-page.module.css";

type Category = "ALL" | "LOYALTY" | "MEMBERSHIP" | "PACKAGE" | "VOUCHER" | "GIFT_CARD" | "CUSTOMER_CREDIT";
type DirectoryState = "ALL" | "AVAILABLE" | "EXPIRING" | "NO_ACTIVE_BENEFITS";
type SortMode = "CUSTOMER_NAME" | "BENEFIT_VALUE_DESC" | "EXPIRY_ASC" | "LOYALTY_DESC";
type LoadState = "loading" | "ready" | "empty" | "error" | "forbidden";

type Filters = {
  search: string;
  category: Category;
  state: DirectoryState;
  membershipTierId: string;
  expiryWindowDays: 7 | 30 | 90;
  hasBalance: boolean | undefined;
  sort: SortMode;
  page: number;
  pageSize: 10 | 20 | 50;
};

type BenefitRow = {
  customer: { id: string; displayName: string; status: string };
  membership: { tierId?: string; tierName?: any; assignmentStatus?: string };
  loyalty: { availablePoints: string; pendingPoints: string; reservedPoints: string };
  packages: { activeCount: number; remainingUnits: number; primaryPackageName?: any; nearestExpiryAt?: string };
  vouchers: { availableCount: number; nearestExpiryAt?: string };
  wallet: { balancesByCurrency: Array<{ currency: string; giftCardMinor: string; customerCreditMinor: string; totalMinor: string }> };
  expiry: { count: number; nearestExpiryAt?: string };
  derivedState: "ACTIVE_BENEFITS" | "EXPIRING_SOON" | "NO_ACTIVE_BENEFITS";
};

type DirectoryData = {
  items: BenefitRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    activeCustomerCount: number;
    customersWithBenefits: number;
    loyaltyAccountCount: number;
    loyaltyAvailablePoints: string;
    activeMembershipCount: number;
    availableVoucherCount: number;
    activePackageCustomerCount: number;
    expiringBenefitCount: number;
    walletBalances: Array<{ currency: string; giftCardMinor: string; customerCreditMinor: string; totalMinor: string }>;
  };
  categoryCounts: Record<Category, number>;
  generatedAt: string;
};

const categories: Array<{ value: Category; label: string; unit: string }> = [
  { value: "ALL", label: "Tất cả quyền lợi", unit: "khách" },
  { value: "LOYALTY", label: "Loyalty", unit: "khách" },
  { value: "MEMBERSHIP", label: "Membership", unit: "khách" },
  { value: "PACKAGE", label: "Gói dịch vụ", unit: "khách" },
  { value: "VOUCHER", label: "Voucher", unit: "voucher" },
  { value: "GIFT_CARD", label: "Gift Card", unit: "thẻ" },
  { value: "CUSTOMER_CREDIT", label: "Store Credit", unit: "khách" },
];

const categoryIcons: Record<Category, string> = {
  ALL: "◉",
  LOYALTY: "★",
  MEMBERSHIP: "♛",
  PACKAGE: "▣",
  VOUCHER: "▤",
  GIFT_CARD: "▱",
  CUSTOMER_CREDIT: "₫",
};

function initialFilters(): Filters {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const category = params.get("category") as Category;
  const state = params.get("state") as DirectoryState;
  const sort = params.get("sort") as SortMode;
  const pageSize = Number(params.get("pageSize"));
  const expiryWindowDays = Number(params.get("expiryWindowDays"));
  const hasBalance = params.get("hasBalance");
  return {
    search: params.get("search") ?? "",
    category: categories.some((item) => item.value === category) ? category : "ALL",
    state: ["ALL", "AVAILABLE", "EXPIRING", "NO_ACTIVE_BENEFITS"].includes(state) ? state : "ALL",
    membershipTierId: params.get("membershipTierId") ?? "",
    expiryWindowDays: [7, 30, 90].includes(expiryWindowDays) ? (expiryWindowDays as 7 | 30 | 90) : 30,
    hasBalance: hasBalance === "true" ? true : undefined,
    sort: ["CUSTOMER_NAME", "BENEFIT_VALUE_DESC", "EXPIRY_ASC", "LOYALTY_DESC"].includes(sort) ? sort : "CUSTOMER_NAME",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: [10, 20, 50].includes(pageSize) ? (pageSize as 10 | 20 | 50) : 10,
  };
}

function displayName(value: any) {
  if (!value) return "—";
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? value.name ?? value.code ?? "—";
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(numberValue(value));
}

function moneyMinor(value: unknown, currency = "VND") {
  const amount = numberValue(value);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(currency === "VND" ? amount : amount / 100);
}

function date(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function statusText(value: BenefitRow["derivedState"]) {
  if (value === "EXPIRING_SOON") return "Sắp hết hạn";
  if (value === "NO_ACTIVE_BENEFITS") return "Chưa có quyền lợi";
  return "Có quyền lợi";
}

function statusTone(value: BenefitRow["derivedState"]) {
  if (value === "EXPIRING_SOON") return styles.statusWarning;
  if (value === "NO_ACTIVE_BENEFITS") return styles.statusMuted;
  return styles.statusSuccess;
}

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(body?.error?.message ?? "Bạn không có quyền xem dữ liệu này."), { forbidden: true });
  }
  if (!response.ok) throw new Error(body?.error?.message ?? "Không thể tải dữ liệu quyền lợi.");
  return body?.data;
}

function queryString(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.category !== "ALL") params.set("category", filters.category);
  if (filters.state !== "ALL") params.set("state", filters.state);
  if (filters.membershipTierId) params.set("membershipTierId", filters.membershipTierId);
  params.set("expiryWindowDays", String(filters.expiryWindowDays));
  if (filters.hasBalance) params.set("hasBalance", "true");
  if (filters.sort !== "CUSTOMER_NAME") params.set("sort", filters.sort);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params.toString();
}

function useDirectory(filters: Filters) {
  const [data, setData] = useState<DirectoryData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState("loading");
      setError("");
      void api(`/v1/benefits/customer-directory?${queryString(filters)}`, { signal: controller.signal })
        .then((next) => {
          setData(next as DirectoryData);
          setState(next?.items?.length ? "ready" : "empty");
        })
        .catch((cause: any) => {
          if (cause?.name === "AbortError") return;
          setError(cause?.message ?? "Không thể tải danh sách quyền lợi.");
          setState(cause?.forbidden ? "forbidden" : "error");
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, reloadToken]);
  return { data, state, error, reload };
}

function useInspector(customerId?: string) {
  const [data, setData] = useState<BenefitRow | null>(null);
  const [state, setState] = useState<LoadState>(customerId ? "loading" : "empty");
  useEffect(() => {
    if (!customerId) {
      setData(null);
      setState("empty");
      return;
    }
    const controller = new AbortController();
    setState("loading");
    void api(`/v1/customers/${encodeURIComponent(customerId)}/benefits/summary`, { signal: controller.signal })
      .then((next) => {
        setData(next as BenefitRow);
        setState("ready");
      })
      .catch((cause: any) => {
        if (cause?.name === "AbortError") return;
        setState(cause?.forbidden ? "forbidden" : "error");
      });
    return () => controller.abort();
  }, [customerId]);
  return { data, state };
}

function MetricCard({ icon, tone, label, value, helper }: { icon: string; tone: string; label: string; value: string; helper?: string }) {
  return <article className={styles.metricCard}><span className={`${styles.metricIcon} ${tone}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong>{helper ? <small>{helper}</small> : null}</div></article>;
}

function StateNotice({ state, error, retry }: { state: LoadState; error?: string; retry: () => void }) {
  if (state === "loading") return <div className={styles.notice} role="status"><span className={styles.spinner} /> Đang tải dữ liệu quyền lợi...</div>;
  if (state === "forbidden") return <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert"><strong>Không có quyền truy cập</strong><span>Tài khoản hiện tại chưa được cấp quyền xem báo cáo quyền lợi.</span></div>;
  if (state === "error") return <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span><button type="button" onClick={retry}>Thử lại</button></div>;
  if (state === "empty") return <div className={styles.emptyState}><strong>Chưa có khách hàng phù hợp</strong><span>Thử thay đổi từ khóa hoặc bộ lọc để tìm dữ liệu thật trong salon.</span></div>;
  return null;
}

function WalletSummary({ balances, compact = false }: { balances: BenefitRow["wallet"]["balancesByCurrency"]; compact?: boolean }) {
  if (!balances?.length) return <span className={styles.muted}>—</span>;
  return <div className={compact ? styles.walletCompact : styles.walletList}>{balances.map((balance) => <span key={balance.currency}><b>{balance.currency}</b> {moneyMinor(balance.totalMinor, balance.currency)}</span>)}</div>;
}

function Inspector({ row, state }: { row: BenefitRow | null; state: LoadState }) {
  if (state === "loading") return <aside className={styles.inspector}><div className={styles.inspectorLoading}><span className={styles.spinner} /> Đang tải chi tiết...</div></aside>;
  if (state === "error") return <aside className={styles.inspector}><div className={styles.inspectorLoading}>Không thể tải chi tiết khách hàng.</div></aside>;
  if (state === "forbidden") return <aside className={styles.inspector}><div className={styles.inspectorLoading}>Chi tiết quyền lợi bị giới hạn theo quyền truy cập.</div></aside>;
  if (!row) return <aside className={styles.inspector}><div className={styles.inspectorEmpty}><span>♙</span><strong>Chọn một khách hàng</strong><p>Chọn một dòng để xem Loyalty, Membership, Gói dịch vụ và ví.</p></div></aside>;
  const wallet = row.wallet?.balancesByCurrency ?? [];
  return <aside className={styles.inspector} aria-label="Chi tiết quyền lợi khách hàng">
    <section className={styles.inspectorCard}><div className={styles.inspectorCustomer}><span className={styles.initials}>{row.customer.displayName.slice(0, 2).toUpperCase()}</span><div><h2>{row.customer.displayName}</h2><span className={`${styles.statusBadge} ${statusTone(row.derivedState)}`}>{statusText(row.derivedState)}</span></div></div><a className={styles.outlineButton} href={`/admin/customers/${row.customer.id}`}>Mở hồ sơ khách hàng ↗</a></section>
    <section className={styles.inspectorCard}><div className={styles.cardTitle}><span className={`${styles.domainIcon} ${styles.purple}`}>★</span><div><h3>Loyalty</h3><strong>{integer(row.loyalty.availablePoints)} điểm</strong></div></div><div className={styles.progress}><span style={{ width: `${Math.min(100, Math.max(4, numberValue(row.loyalty.availablePoints) / 10))}%` }} /></div><p className={styles.cardHint}>Điểm khả dụng từ tài khoản Loyalty</p><a className={styles.textLink} href={`/admin/loyalty/customers/${row.customer.id}`}>Xem lịch sử điểm →</a></section>
    <section className={styles.inspectorCard}><div className={styles.cardTitle}><span className={`${styles.domainIcon} ${styles.gold}`}>♛</span><div><h3>Membership</h3><strong>{displayName(row.membership.tierName)}</strong></div></div><p className={styles.cardHint}>{row.membership.assignmentStatus === "ACTIVE" ? "Đang hoạt động" : "Chưa có hạng hoạt động"}</p><a className={styles.textLink} href={`/admin/membership/customers/${row.customer.id}`}>Xem Membership →</a></section>
    <section className={styles.inspectorCard}><div className={styles.cardTitle}><span className={`${styles.domainIcon} ${styles.coral}`}>▣</span><div><h3>Gói dịch vụ</h3><strong>{integer(row.packages.activeCount)} gói đang dùng</strong></div></div><p className={styles.cardHint}>{row.packages.activeCount ? `${integer(row.packages.remainingUnits)} lượt còn lại` : "Không có gói khả dụng"}</p><a className={styles.textLink} href="/admin/packages/entitlements">Xem entitlement →</a></section>
    <section className={styles.inspectorCard}><div className={styles.cardTitle}><span className={`${styles.domainIcon} ${styles.blue}`}>₫</span><div><h3>Gift Card & Store Credit</h3><strong>{wallet.length ? `${wallet.length} loại tiền` : "Chưa có số dư"}</strong></div></div><WalletSummary balances={wallet} /><a className={styles.textLink} href="/admin/gift-cards">Mở Gift Card →</a></section>
    <section className={styles.inspectorCard}><div className={styles.cardTitle}><span className={`${styles.domainIcon} ${styles.orange}`}>◷</span><div><h3>Sắp hết hạn</h3><strong>{integer(row.expiry.count)} quyền lợi</strong></div></div><p className={styles.cardHint}>{row.expiry.nearestExpiryAt ? `Gần nhất: ${date(row.expiry.nearestExpiryAt)}` : "Không có quyền lợi sắp hết hạn"}</p></section>
  </aside>;
}

function CustomerTable({ data, selectedId, onSelect }: { data: DirectoryData | null; selectedId: string | undefined; onSelect: (row: BenefitRow) => void }) {
  const items = data?.items ?? [];
  return <section className={styles.tableCard}><div className={styles.sectionHeader}><div><h2>Khách hàng & quyền lợi</h2><p>{data?.pagination.total ?? 0} khách hàng trong kết quả hiện tại</p></div><span className={styles.livePill}>● Dữ liệu server</span></div><div className={styles.tableWrap}><table><caption className={styles.srOnly}>Danh sách khách hàng và quyền lợi</caption><thead><tr><th scope="col">Khách hàng</th><th scope="col">Membership</th><th scope="col">Loyalty</th><th scope="col">Gói dịch vụ</th><th scope="col">Voucher</th><th scope="col">Gift Card / Credit</th><th scope="col">Sắp hết hạn</th><th scope="col">Trạng thái</th><th scope="col"><span className={styles.srOnly}>Thao tác</span></th></tr></thead><tbody>{items.map((row) => <tr key={row.customer.id} aria-selected={row.customer.id === selectedId} className={row.customer.id === selectedId ? styles.selectedRow : undefined} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row); }} tabIndex={0}><td><strong>{row.customer.displayName}</strong><small>{row.customer.status}</small></td><td>{row.membership.tierId ? <span className={styles.valueAccent}>{displayName(row.membership.tierName)}</span> : <span className={styles.muted}>—</span>}</td><td><strong>{integer(row.loyalty.availablePoints)}</strong><small>điểm</small></td><td>{row.packages.activeCount ? <><strong>{integer(row.packages.activeCount)}</strong><small>{integer(row.packages.remainingUnits)} lượt</small></> : <span className={styles.muted}>—</span>}</td><td>{row.vouchers.availableCount ? <strong>{integer(row.vouchers.availableCount)}</strong> : <span className={styles.muted}>—</span>}</td><td><WalletSummary balances={row.wallet.balancesByCurrency} compact /></td><td>{row.expiry.count ? <><span className={styles.warningText}>{integer(row.expiry.count)} quyền lợi</span><small>{date(row.expiry.nearestExpiryAt)}</small></> : <span className={styles.muted}>—</span>}</td><td><span className={`${styles.statusBadge} ${statusTone(row.derivedState)}`}>{statusText(row.derivedState)}</span></td><td><button className={styles.rowAction} type="button" onClick={(event) => { event.stopPropagation(); onSelect(row); }}>Xem quyền lợi</button></td></tr>)}</tbody></table></div></section>;
}

export default function CustomerBenefitsPage() {
  const [filters, setFilters] = useState<Filters>(() => initialFilters());
  const directory = useDirectory(filters);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [tiers, setTiers] = useState<any[]>([]);
  const inspector = useInspector(selectedId);
  const selectedFromPage = directory.data?.items.find((row) => row.customer.id === selectedId);

  useEffect(() => {
    void api("/v1/membership-tiers").then((data) => setTiers(Array.isArray(data) ? data : data?.items ?? [])).catch(() => setTiers([]));
  }, []);
  useEffect(() => {
    if (!directory.data?.items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !directory.data.items.some((row) => row.customer.id === selectedId)) setSelectedId(directory.data.items[0]?.customer.id);
  }, [directory.data, selectedId]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    ["search", "category", "state", "membershipTierId", "expiryWindowDays", "hasBalance", "sort", "page", "pageSize"].forEach((key) => params.delete(key));
    const next = queryString(filters);
    new URLSearchParams(next).forEach((value, key) => params.set(key, value));
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [filters]);

  const selected = inspector.data ?? selectedFromPage ?? null;
  const summary = directory.data?.summary;
  const ratio = summary?.activeCustomerCount ? Math.round((summary.customersWithBenefits / summary.activeCustomerCount) * 100) : 0;
  const walletLabel = useMemo(() => {
    const balances = summary?.walletBalances ?? [];
    return balances.length === 1 && balances[0] ? moneyMinor(balances[0].totalMinor, balances[0].currency) : balances.length ? `${balances.length} loại tiền` : "—";
  }, [summary?.walletBalances]);

  function updateFilters(next: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...next, ...(Object.keys(next).some((key) => key !== "page" && key !== "pageSize") ? { page: 1 } : {}) }));
  }
  function reset() {
    setFilters((current) => ({ ...current, search: "", category: "ALL", state: "ALL", membershipTierId: "", expiryWindowDays: 30, hasBalance: undefined, sort: "CUSTOMER_NAME", page: 1 }));
  }
  async function exportDirectory() {
    setNotice("Đang tạo yêu cầu xuất báo cáo...");
    try {
      const result = await api("/v1/benefits/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `benefits-export-${Date.now()}` }, body: JSON.stringify({ exportType: "CUSTOMER_DIRECTORY", filters: { search: filters.search || undefined, category: filters.category, state: filters.state, membershipTierId: filters.membershipTierId || undefined, expiryWindowDays: filters.expiryWindowDays } }) });
      setNotice(result?.delivery?.enabled ? "Báo cáo đã sẵn sàng để tải." : "Đã tạo yêu cầu xuất báo cáo. Kho lưu trữ chưa được cấu hình để tải file trực tiếp.");
    } catch (cause: any) {
      setNotice(cause?.message ?? "Không thể tạo yêu cầu xuất báo cáo.");
    }
  }

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><nav className={styles.breadcrumb} aria-label="Breadcrumb"><a href="/admin/customers">Khách hàng</a><span>/</span><span>Quyền lợi</span></nav><h1>Quyền lợi khách hàng</h1><p>Theo dõi Loyalty, Membership, Voucher, Gift Card, Store Credit và các quyền lợi đang khả dụng của khách hàng.</p><p className={styles.tenantNote}>Quyền lợi được quản lý trên toàn salon. Chi nhánh được kiểm tra tại thời điểm áp dụng nếu chính sách yêu cầu.</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={() => void exportDirectory()}>Xuất báo cáo <span>↓</span></button><details className={styles.menu}><summary className={styles.secondaryButton}>Quản lý chính sách <span>⌄</span></summary><div className={styles.menuPanel}><a href="/admin/loyalty/programs">Loyalty Programs</a><a href="/admin/membership/tiers">Membership Tiers</a><a href="/admin/packages/catalog">Gói dịch vụ</a><a href="/admin/vouchers/campaigns">Voucher Campaigns</a><a href="/admin/gift-cards/products">Gift Card Products</a></div></details><button className={styles.primaryButton} type="button" onClick={() => document.getElementById("benefit-search")?.focus()}>⌕ Tra cứu quyền lợi</button></div></header>
    {notice ? <div className={styles.toast} role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Đóng thông báo">×</button></div> : null}
    <section className={styles.metricsGrid} aria-label="Tổng quan quyền lợi"><MetricCard icon="♙" tone={styles.pink ?? ""} label="Khách có quyền lợi" value={integer(summary?.customersWithBenefits)} helper={summary?.activeCustomerCount ? `${ratio}% trên ${integer(summary.activeCustomerCount)} khách hoạt động` : "Chưa có dữ liệu"} /><MetricCard icon="★" tone={styles.lavender ?? ""} label="Điểm Loyalty khả dụng" value={integer(summary?.loyaltyAvailablePoints)} helper={`${integer(summary?.loyaltyAccountCount)} tài khoản`} /><MetricCard icon="♛" tone={styles.gold ?? ""} label="Membership đang hoạt động" value={integer(summary?.activeMembershipCount)} helper="Assignment đang hiệu lực" /><MetricCard icon="▤" tone={styles.coral ?? ""} label="Voucher khả dụng" value={integer(summary?.availableVoucherCount)} helper="Chưa dùng hoặc dùng một phần" /><MetricCard icon="₫" tone={styles.blue ?? ""} label="Gift Card & Credit" value={walletLabel} helper="Theo từng loại tiền" /><MetricCard icon="◷" tone={styles.orange ?? ""} label="Sắp hết hạn" value={integer(summary?.expiringBenefitCount)} helper={`Trong ${filters.expiryWindowDays} ngày tới`} /></section>
    <section className={styles.categoryStrip} aria-label="Lọc theo loại quyền lợi">{categories.map((category) => <button key={category.value} className={filters.category === category.value ? styles.categoryActive : undefined} type="button" onClick={() => updateFilters({ category: category.value })}><span className={styles.categoryIcon}>{categoryIcons[category.value]}</span><span><strong>{category.label}</strong><small>{integer(directory.data?.categoryCounts?.[category.value])} {category.unit}</small></span></button>)}</section>
    <section className={styles.filterCard}><div className={styles.filterGrid}><label className={styles.searchField} htmlFor="benefit-search"><span>⌕</span><input id="benefit-search" value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Tìm khách hàng / SĐT / mã quyền lợi..." /></label><label>Chi nhánh<span className={styles.readonlyField}>Toàn salon</span></label><label>Loại quyền lợi<select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value as Category })}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Trạng thái<select value={filters.state} onChange={(event) => updateFilters({ state: event.target.value as DirectoryState })}><option value="ALL">Tất cả</option><option value="AVAILABLE">Đang khả dụng</option><option value="EXPIRING">Sắp hết hạn</option><option value="NO_ACTIVE_BENEFITS">Chưa có quyền lợi</option></select></label><label>Hạng khách hàng<select value={filters.membershipTierId} onChange={(event) => updateFilters({ membershipTierId: event.target.value })}><option value="">Tất cả</option>{tiers.map((tier) => <option key={tier.id} value={tier.id}>{displayName(tier.name ?? tier.nameJson) || tier.code}</option>)}</select></label><label>Ngưỡng sắp hết hạn<select value={filters.expiryWindowDays} onChange={(event) => updateFilters({ expiryWindowDays: Number(event.target.value) as 7 | 30 | 90 })}><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option></select></label></div><div className={styles.filterFooter}><div className={styles.filterChips}><button className={filters.state === "ALL" ? styles.chipActive : undefined} type="button" onClick={() => updateFilters({ state: "ALL" })}>Tất cả</button><button className={filters.state === "AVAILABLE" ? styles.chipActive : undefined} type="button" onClick={() => updateFilters({ state: "AVAILABLE" })}>Đang khả dụng</button><button className={filters.state === "EXPIRING" ? styles.chipActive : undefined} type="button" onClick={() => updateFilters({ state: "EXPIRING" })}>Sắp hết hạn</button><button className={filters.hasBalance ? styles.chipActive : undefined} type="button" onClick={() => updateFilters({ hasBalance: filters.hasBalance ? undefined : true })}>Có số dư</button><button className={filters.state === "NO_ACTIVE_BENEFITS" ? styles.chipActive : undefined} type="button" onClick={() => updateFilters({ state: "NO_ACTIVE_BENEFITS" })}>Chưa có quyền lợi</button></div><div className={styles.filterActions}><label className={styles.sortLabel}>Sắp xếp<select value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as SortMode })}><option value="CUSTOMER_NAME">Tên khách hàng</option><option value="BENEFIT_VALUE_DESC">Giá trị quyền lợi</option><option value="EXPIRY_ASC">Sắp hết hạn trước</option><option value="LOYALTY_DESC">Loyalty cao nhất</option></select></label><label className={styles.pageSizeLabel}>Hiển thị<select value={filters.pageSize} onChange={(event) => updateFilters({ pageSize: Number(event.target.value) as 10 | 20 | 50 })}><option value="10">10 / trang</option><option value="20">20 / trang</option><option value="50">50 / trang</option></select></label><button className={styles.resetButton} type="button" onClick={reset}>Xóa bộ lọc</button></div></div></section>
    <StateNotice state={directory.state} error={directory.error} retry={directory.reload} />
    <div className={styles.contentGrid}><div className={styles.mainColumn}>{directory.state === "ready" ? <CustomerTable data={directory.data} selectedId={selectedId} onSelect={(row) => setSelectedId(row.customer.id)} /> : null}{directory.state === "ready" && directory.data ? <div className={styles.pagination}><span>Hiển thị {(directory.data.pagination.page - 1) * directory.data.pagination.pageSize + 1}–{Math.min(directory.data.pagination.page * directory.data.pagination.pageSize, directory.data.pagination.total)} trong {integer(directory.data.pagination.total)} khách hàng</span><div><button type="button" disabled={filters.page <= 1} onClick={() => updateFilters({ page: filters.page - 1 })}>‹</button><strong>{filters.page}</strong><span>/ {directory.data.pagination.totalPages}</span><button type="button" disabled={filters.page >= directory.data.pagination.totalPages} onClick={() => updateFilters({ page: filters.page + 1 })}>›</button></div></div> : null}<section className={styles.lowerGrid}><article className={styles.lowerCard}><div className={styles.sectionHeader}><div><h2>Phân bổ quyền lợi</h2><p>Khách hàng theo từng domain</p></div></div><div className={styles.distribution}>{categories.slice(1).map((category) => <div key={category.value}><span><i style={{ background: `var(--benefit-${category.value.toLowerCase()})` }} />{category.label}</span><strong>{integer(directory.data?.categoryCounts?.[category.value])}</strong></div>)}</div></article><article className={styles.lowerCard}><div className={styles.sectionHeader}><div><h2>Quyền lợi sắp hết hạn</h2><p>Ngưỡng đang xem: {filters.expiryWindowDays} ngày</p></div><span className={styles.warningText}>{integer(summary?.expiringBenefitCount)} mục</span></div><div className={styles.expiryEmpty}>{summary?.expiringBenefitCount ? "Danh sách chi tiết được hiển thị theo bộ lọc Sắp hết hạn." : "Không có quyền lợi sắp hết hạn trong ngưỡng hiện tại."}</div></article><article className={styles.lowerCard}><div className={styles.sectionHeader}><div><h2>Hoạt động quyền lợi</h2><p>Audit theo từng khách hàng</p></div></div><div className={styles.expiryEmpty}>Mở hồ sơ khách hàng để xem lịch sử Loyalty, Voucher và Package theo domain thật.</div></article></section></div><Inspector row={selected} state={inspector.state} /></div>
  </main>;
}
