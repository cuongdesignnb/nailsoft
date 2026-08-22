"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { authorizedFetch } from "../auth";
import styles from "./membership-hub.module.css";

type Localized = string | Record<string, string> | null | undefined;
type Benefit = { type?: string; value?: number | string; [key: string]: unknown };
type Tier = {
  id: string;
  code?: string | null;
  name: Localized;
  priority: number;
  qualificationType?: string | null;
  qualificationThreshold?: string | null;
  rollingWindowDays?: number | null;
  benefits?: Benefit[];
  activeCount?: number;
};
type DirectoryItem = {
  customer: { id: string; displayName: string; phone?: string | null; email?: string | null; status?: string };
  current: {
    assignmentId: string;
    tier: Tier | null;
    status: string;
    source: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    graceUntil?: string | null;
    benefitSnapshot?: Benefit[] | null;
  } | null;
  progress: {
    bucket: string;
    currentValue: string;
    targetValue?: string | null;
    percentage?: number | null;
    qualificationType?: string | null;
    nextTier?: Tier | null;
    lastEvaluatedAt?: string | null;
  };
  customerValueMinor?: string | null;
};
type Overview = {
  totals: { activeMembershipCount: number; activeCustomerCount: number; membershipCoveragePercent: number; expiring30dCount: number };
  tiers: Tier[];
  distribution: { tierId: string; activeCount: number; activePercent: number }[];
  expiring: { windowDays: number; count: number; customers: { customerId: string; displayName: string; tierName: Localized; effectiveTo: string }[] };
  upgradeOpportunities: { customerId: string; displayName: string; assignmentSource: string; nextTier: { id: string; name: Localized; qualificationType: string; threshold: string }; currentValue: string; percentage: number | null }[];
  financial: { visible: boolean; membershipRevenueMinor?: string; reason?: string };
  generatedAt: string;
};
type DirectoryResponse = { items: DirectoryItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; active: number; expiring: number; nearUpgrade: number } };
type MembershipSummary = {
  customer: { id: string; displayName: string; phone?: string | null; email?: string | null; status?: string };
  currentAssignment: DirectoryItem["current"];
  nextTier: Tier | null;
  progress: { currentValue: string | null; targetValue: string | null; percentage: number | null; lastEvaluatedAt?: string | null };
  qualificationMetrics: { rollingSpendMinor: string; lifetimeSpendMinor: string; visitCount: string; lifetimeEarnedPoints: string } | null;
  loyalty: { availablePoints: string; pendingPoints: string; reservedPoints: string; lifetimeEarnedPoints: string } | null;
  usage: { count: number; valueMinor: string; lastUsedAt?: string | null };
  financial: { visible: boolean; reason?: string };
  history: { id: string; tier: Tier; status: string; source: string; effectiveFrom: string; effectiveTo?: string | null; graceUntil?: string | null; benefitSnapshot?: Benefit[] | null }[];
};
type Filters = { tierId: string; assignmentState: string; assignmentSource: string; expiryWindowDays: string; progressBucket: string; sort: string };

const emptyFilters: Filters = { tierId: "", assignmentState: "ALL", assignmentSource: "ALL", expiryWindowDays: "30", progressBucket: "ALL", sort: "CUSTOMER_NAME" };

function localized(value: Localized, fallback: string | null | undefined = "—"): string {
  if (!value) return fallback ?? "—";
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? Object.values(value)[0] ?? fallback ?? "—";
}

function integer(value?: string | number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN").format(Number(value));
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function qualificationLabel(type?: string | null) {
  switch (type) {
    case "ROLLING_SPEND": return "Chi tiêu trong kỳ";
    case "LIFETIME_SPEND": return "Tổng chi tiêu";
    case "VISIT_COUNT": return "Số lượt ghé";
    case "POINTS_EARNED": return "Điểm đã tích lũy";
    case "MANUAL": return "Xét thủ công";
    default: return "Chưa cấu hình tiêu chí";
  }
}

function sourceLabel(source?: string) { return source === "MANUAL" ? "Thủ công" : source === "AUTOMATIC" ? "Tự động" : "—"; }

function benefitLabel(benefit: Benefit) {
  const type = String(benefit.type ?? "BENEFIT");
  const value = benefit.value == null ? "" : ` · ${type === "PERCENT_DISCOUNT" ? `${Number(benefit.value) / 100}%` : String(benefit.value)}`;
  const labels: Record<string, string> = { PERCENT_DISCOUNT: "Giảm giá dịch vụ", PRIORITY_BOOKING: "Ưu tiên đặt lịch", BIRTHDAY_REWARD: "Quà sinh nhật", BONUS_POINTS: "Điểm thưởng" };
  return `${labels[type] ?? type.replaceAll("_", " ")}${value}`;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await authorizedFetch(path, signal ? { signal } : {});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Không thể tải dữ liệu Membership.");
  return body.data as T;
}

export default function MembershipHub() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [summary, setSummary] = useState<MembershipSummary | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getJson<Overview>("/v1/memberships/overview", controller.signal), getJson<DirectoryResponse>("/v1/memberships/directory?page=1&pageSize=10&sort=CUSTOMER_NAME", controller.signal)])
      .then(([nextOverview, nextDirectory]) => {
        setOverview(nextOverview);
        setDirectory(nextDirectory);
        setSelectedId(new URLSearchParams(window.location.search).get("customerId") ?? nextDirectory.items[0]?.customer.id ?? null);
      })
      .catch((reason: unknown) => { if ((reason as Error)?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Không thể tải Membership."); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: "1", pageSize: "10", sort: filters.sort, assignmentState: filters.assignmentState, assignmentSource: filters.assignmentSource, expiryWindowDays: filters.expiryWindowDays, progressBucket: filters.progressBucket });
    if (filters.tierId) params.set("tierId", filters.tierId);
    if (search) params.set("search", search);
    setDirectoryLoading(true);
    setDirectoryError(null);
    void getJson<DirectoryResponse>(`/v1/memberships/directory?${params.toString()}`, controller.signal)
      .then((value) => { setDirectory(value); if (!value.items.some((item) => item.customer.id === selectedId)) setSelectedId(value.items[0]?.customer.id ?? null); })
      .catch((reason: unknown) => { if ((reason as Error)?.name !== "AbortError") setDirectoryError(reason instanceof Error ? reason.message : "Không thể tải danh sách."); })
      .finally(() => setDirectoryLoading(false));
    return () => controller.abort();
  }, [filters, search, loading]);

  useEffect(() => {
    if (!selectedId) { setSummary(null); return; }
    const controller = new AbortController();
    setSummaryLoading(true);
    void getJson<MembershipSummary>(`/v1/customers/${encodeURIComponent(selectedId)}/membership/summary`, controller.signal)
      .then(setSummary)
      .catch((reason: unknown) => { if ((reason as Error)?.name !== "AbortError") setSummary(null); })
      .finally(() => setSummaryLoading(false));
    return () => controller.abort();
  }, [selectedId]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const exportMembership = async () => {
    setExporting(true);
    try {
      const response = await authorizedFetch("/v1/benefits/exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exportType: "MEMBERSHIP", filters: { search, ...filters } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? "Không thể tạo yêu cầu xuất dữ liệu.");
      setError(`Đã tạo yêu cầu xuất dữ liệu (${body.data?.status ?? "PENDING"}). File sẽ được xử lý theo quyền export.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tạo yêu cầu xuất dữ liệu."); }
    finally { setExporting(false); }
  };

  if (loading) return <main className={styles.page}><div className={styles.loading}><span /><span /><span /></div></main>;
  if (error && !overview) return <main className={styles.page}><section className={styles.error} role="alert"><strong>Không thể tải Membership</strong><span>{error}</span><button type="button" onClick={() => window.location.reload()}>Thử lại</button></section></main>;
  if (!overview) return null;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.breadcrumb}><span>Khách hàng</span><b>/</b><strong>Membership</strong></div><h1>Membership &amp; Hạng thành viên</h1><p>Theo dõi cấp độ thành viên, quyền lợi, tiến độ thăng hạng và thời hạn theo chính sách đang có hiệu lực.</p></div>
      <div className={styles.actions}><button className={styles.button} type="button" onClick={() => void exportMembership()} disabled={exporting}>{exporting ? "Đang tạo file…" : "↓ Xuất báo cáo"}</button><Link className={styles.button} href="/admin/membership/tiers">⚙ Quản lý chính sách</Link><Link className={`${styles.button} ${styles.primary}`} href="/admin/customers">⌕ Tra cứu khách hàng</Link></div>
    </header>
    {error ? <section className={styles.notice} role="status"><span>{error}</span><button type="button" onClick={() => setError(null)}>Đóng</button></section> : null}

    <section className={styles.kpis} aria-label="Tổng quan Membership">
      <Kpi icon="M" label="Membership đang hoạt động" value={integer(overview.totals.activeMembershipCount)} meta={`${overview.totals.membershipCoveragePercent}% khách đang hoạt động`} />
      {overview.tiers.map((tier, index) => <Kpi key={tier.id} icon={index === 0 ? "•" : index === overview.tiers.length - 1 ? "◇" : "☆"} tone={index % 4} label={localized(tier.name, tier.code ?? "Tier")} value={integer(tier.activeCount)} meta={`${overview.distribution.find((item) => item.tierId === tier.id)?.activePercent ?? 0}% phân bổ`} />)}
      <Kpi icon="◷" tone={2} label="Sắp hết hạn" value={integer(overview.totals.expiring30dCount)} meta="Trong 30 ngày tới" />
    </section>

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><h2>Phân bổ hạng thành viên</h2><p>Chỉ tính assignment ACTIVE trong cửa sổ hiệu lực hiện tại.</p></div><strong>{integer(overview.totals.activeMembershipCount)} khách</strong></div>
      <div className={styles.distribution}>{overview.tiers.map((tier, index) => <div key={tier.id} className={styles.distributionSegment} style={{ width: `${Math.max(overview.distribution.find((item) => item.tierId === tier.id)?.activePercent ?? 0, 0)}%`, background: ["#ed3f65", "#a7a9b8", "#e6a43a", "#df5a8b", "#62a0df"][index % 5] }} title={`${localized(tier.name)}: ${tier.activeCount ?? 0}`} />)}</div>
      <div className={styles.distributionLabels}>{overview.tiers.map((tier, index) => <div key={tier.id}><strong className={index % 2 === 0 ? styles.roseText : styles.neutralText}>{overview.distribution.find((item) => item.tierId === tier.id)?.activePercent ?? 0}%</strong><span>{localized(tier.name)}</span><small>{integer(tier.activeCount)} khách</small></div>)}</div>
    </section>

    <section className={styles.tierGrid} aria-label="Chính sách hạng">
      {overview.tiers.map((tier, index) => <article className={`${styles.tierCard} ${index === overview.tiers.length - 1 ? styles.tierHighlight : ""}`} key={tier.id}><div className={styles.tierIcon}>{index === 0 ? "♧" : index === 1 ? "☆" : index === 2 ? "♕" : "◇"}</div><div><h2>{localized(tier.name, tier.code ?? "Tier")}</h2><p>{qualificationLabel(tier.qualificationType)}{tier.qualificationType === "ROLLING_SPEND" && tier.rollingWindowDays ? ` · ${tier.rollingWindowDays} ngày` : ""}</p><ul>{(tier.benefits ?? []).slice(0, 3).map((benefit, benefitIndex) => <li key={`${tier.id}-${benefitIndex}`}>{benefitLabel(benefit)}</li>)}</ul></div></article>)}
    </section>

    <section className={styles.filters} aria-label="Bộ lọc Membership"><div className={styles.filterRow}><label className={styles.search}><span>Tìm khách hàng / SĐT / Membership</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm kiếm…" aria-label="Tìm khách hàng" /></label><Select label="Hạng thành viên" value={filters.tierId} onChange={(value) => setFilter("tierId", value)}><option value="">Tất cả hạng</option>{overview.tiers.map((tier) => <option value={tier.id} key={tier.id}>{localized(tier.name, tier.code)}</option>)}</Select><Select label="Trạng thái assignment" value={filters.assignmentState} onChange={(value) => setFilter("assignmentState", value)}><option value="ALL">Tất cả</option><option value="ACTIVE">Đang hoạt động</option><option value="EXPIRING">Sắp hết hạn</option><option value="NO_ACTIVE">Chưa có hạng</option></Select><Select label="Nguồn gán hạng" value={filters.assignmentSource} onChange={(value) => setFilter("assignmentSource", value)}><option value="ALL">Tất cả</option><option value="AUTOMATIC">Tự động</option><option value="MANUAL">Thủ công</option></Select><Select label="Tiến độ" value={filters.progressBucket} onChange={(value) => setFilter("progressBucket", value)}><option value="ALL">Tất cả</option><option value="NEAR_UPGRADE">Sắp lên hạng</option><option value="IN_PROGRESS">Đang tích lũy</option><option value="MANUAL">Xét thủ công</option><option value="MAX_TIER">Hạng cao nhất</option></Select><Select label="Sắp xếp" value={filters.sort} onChange={(value) => setFilter("sort", value)}><option value="CUSTOMER_NAME">Tên khách hàng</option><option value="POINTS_DESC">Điểm cao nhất</option><option value="SPENDING_DESC">Chi tiêu cao nhất</option><option value="EXPIRY_ASC">Sắp hết hạn</option><option value="PROGRESS_DESC">Tiến độ cao nhất</option></Select></div><div className={styles.chips}><button className={filters.assignmentState === "ALL" ? styles.activeChip : ""} type="button" onClick={() => setFilter("assignmentState", "ALL")}>Tất cả <small>{directory?.summary.total ?? 0}</small></button><button className={filters.progressBucket === "NEAR_UPGRADE" ? styles.activeChip : ""} type="button" onClick={() => setFilter("progressBucket", "NEAR_UPGRADE")}>Sắp lên hạng <small>{directory?.summary.nearUpgrade ?? 0}</small></button><button className={filters.assignmentState === "EXPIRING" ? styles.activeChip : ""} type="button" onClick={() => setFilter("assignmentState", "EXPIRING")}>Sắp hết hạn <small>{directory?.summary.expiring ?? 0}</small></button><button type="button" onClick={() => { setFilters(emptyFilters); setSearchDraft(""); }}>Đặt lại</button></div></section>

    <div className={styles.mainGrid}><section className={styles.card}><div className={styles.cardHeader}><div><h2>Danh sách thành viên</h2><p>{directory?.pagination.total ?? 0} khách hàng · dữ liệu theo assignment snapshot</p></div>{directoryLoading ? <span className={styles.loadingText}>Đang cập nhật…</span> : null}</div>{directoryError ? <section className={styles.error} role="alert"><span>{directoryError}</span><button type="button" onClick={() => setSearch((value) => `${value} `)}>Thử lại</button></section> : null}<div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Danh sách Membership</caption><thead><tr><th scope="col">Khách hàng</th><th scope="col">Hạng</th><th scope="col">Tiến độ</th><th scope="col">Nguồn</th><th scope="col">Hết hạn</th><th scope="col">Trạng thái</th><th scope="col"><span className={styles.srOnly}>Thao tác</span></th></tr></thead><tbody>{directory?.items.map((item) => <tr key={item.customer.id} className={item.customer.id === selectedId ? styles.selectedRow : ""} aria-selected={item.customer.id === selectedId}><td><button type="button" className={styles.customerButton} onClick={() => setSelectedId(item.customer.id)}><span className={styles.avatar}>{item.customer.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{item.customer.displayName}</strong><small>{item.customer.phone ?? item.customer.email ?? "Thông tin liên hệ bị giới hạn"}</small></span></button></td><td><strong>{localized(item.current?.tier?.name, "Chưa có hạng")}</strong><small>{item.current?.tier?.code ?? "—"}</small></td><td><div className={styles.progressCell}><span>{item.progress.percentage == null ? "—" : `${item.progress.percentage}%`}</span><i><b style={{ width: `${Math.min(100, Math.max(0, item.progress.percentage ?? 0))}%` }} /></i><small>{item.progress.nextTier ? `Mục tiêu: ${localized(item.progress.nextTier.name)}` : qualificationLabel(item.progress.qualificationType)}</small></div></td><td><span className={styles.badge}>{sourceLabel(item.current?.source)}</span></td><td>{date(item.current?.effectiveTo)}<small>{item.current?.effectiveTo ? "Ngày kết thúc hiệu lực" : "Không thời hạn"}</small></td><td><span className={`${styles.status} ${item.progress.bucket === "NEAR_UPGRADE" || item.current == null ? styles.statusAmber : styles.statusGreen}`}>{item.current == null ? "Chưa có hạng" : item.progress.bucket === "NEAR_UPGRADE" ? "Sắp lên hạng" : item.current.status}</span></td><td><button type="button" className={styles.detailButton} onClick={() => setSelectedId(item.customer.id)}>Chi tiết</button></td></tr>)}</tbody></table>{directory?.items.length === 0 ? <div className={styles.empty}><strong>Chưa có khách hàng phù hợp</strong><span>Thử nới bộ lọc hoặc tìm kiếm khác.</span></div> : null}</div></section>
      <aside className={styles.inspector} aria-label="Chi tiết Membership">{summaryLoading ? <div className={styles.inspectorLoading}>Đang tải chi tiết…</div> : summary ? <MembershipInspector summary={summary} /> : <div className={styles.empty}><strong>Chọn một khách hàng</strong><span>Chi tiết Membership sẽ hiển thị ở đây.</span></div>}</aside></div>

    <section className={styles.bottomGrid}><section className={styles.card}><div className={styles.cardHeader}><div><h2>Sắp hết hạn</h2><p>Assignment còn hiệu lực trong {overview.expiring.windowDays} ngày</p></div><span className={styles.badge}>{overview.expiring.count} khách</span></div>{overview.expiring.customers.length ? overview.expiring.customers.map((item) => <Link className={styles.listRow} href={`/admin/membership/customers/${item.customerId}`} key={item.customerId}><span><strong>{item.displayName}</strong><small>{localized(item.tierName)}</small></span><b>{date(item.effectiveTo)}</b></Link>) : <div className={styles.empty}><strong>Không có hạng sắp hết hạn</strong><span>Danh sách này được tính từ effective_to của assignment.</span></div>}</section><section className={styles.card}><div className={styles.cardHeader}><div><h2>Cơ hội thăng hạng</h2><p>Khách tự động đang đạt từ 90% tiêu chí tier kế tiếp</p></div><span className={styles.badge}>{overview.upgradeOpportunities.length}</span></div>{overview.upgradeOpportunities.length ? overview.upgradeOpportunities.map((item) => <button type="button" className={styles.listRow} onClick={() => setSelectedId(item.customerId)} key={item.customerId}><span><strong>{item.displayName}</strong><small>{localized(item.nextTier.name)} · {qualificationLabel(item.nextTier.qualificationType)}</small></span><b>{item.percentage == null ? "—" : `${Math.round(item.percentage)}%`}</b></button>) : <div className={styles.empty}><strong>Chưa có cơ hội thăng hạng</strong><span>Hệ thống không tự nâng hạng từ dữ liệu trình duyệt.</span></div>}</section></section>
    <footer className={styles.footer}><span>Dữ liệu cập nhật {date(overview.generatedAt)} · Quyền hiển thị được áp dụng theo server.</span><Link className={styles.button} href="/admin/membership/tiers">Xem chính sách hạng</Link></footer>
  </main>;
}

function Kpi({ icon, label, value, meta, tone = 0 }: { icon: string; label: string; value: string; meta: string; tone?: number }) { return <article className={`${styles.kpi} ${styles[`tone${tone}`]}`}><span className={styles.kpiIcon}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></article>; }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) { return <label className={styles.select}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }

function MembershipInspector({ summary }: { summary: MembershipSummary }) {
  const current = summary.currentAssignment;
  return <div className={styles.inspectorInner}><div className={styles.inspectorHead}><span className={styles.avatarLarge}>{summary.customer.displayName.slice(0, 2).toUpperCase()}</span><div><h2>{summary.customer.displayName}</h2><p>{summary.customer.phone ?? summary.customer.email ?? "Thông tin liên hệ bị giới hạn"}</p><span className={styles.statusGreen}>{current?.tier ? localized(current.tier.name) : "Chưa có hạng"}</span></div></div><div className={styles.inspectorLinks}><Link href={`/admin/customers/${summary.customer.id}`}>Mở hồ sơ khách hàng →</Link><Link href={`/admin/membership/customers/${summary.customer.id}`}>Lịch sử Membership →</Link><Link href={`/admin/loyalty/customers/${summary.customer.id}`}>Loyalty &amp; điểm →</Link></div><dl className={styles.details}><div><dt>Hạng hiện tại</dt><dd>{localized(current?.tier?.name, "Chưa có hạng")}</dd></div><div><dt>Nguồn gán hạng</dt><dd>{sourceLabel(current?.source)}</dd></div><div><dt>Hiệu lực đến</dt><dd>{date(current?.effectiveTo)}</dd></div><div><dt>Tiến độ hạng kế tiếp</dt><dd>{summary.progress.percentage == null ? "—" : `${Math.round(summary.progress.percentage)}%`}</dd></div><div><dt>Điểm Loyalty</dt><dd>{summary.loyalty ? `${integer(summary.loyalty.availablePoints)} điểm` : "—"}</dd></div><div><dt>Lượt áp dụng quyền lợi</dt><dd>{integer(summary.usage.count)}</dd></div></dl>{summary.nextTier ? <div className={styles.nextTier}><span>Tier tiếp theo</span><strong>{localized(summary.nextTier.name)}</strong><small>{qualificationLabel(summary.nextTier.qualificationType)} · Mục tiêu {integer(summary.progress.targetValue)}</small><i><b style={{ width: `${Math.min(100, Math.max(0, summary.progress.percentage ?? 0))}%` }} /></i></div> : null}<div className={styles.snapshot}><div className={styles.cardHeader}><h3>Quyền lợi theo snapshot</h3><small>Không tự lấy lại policy hiện tại</small></div>{current?.benefitSnapshot?.length ? current.benefitSnapshot.map((benefit, index) => <span key={index}>✓ {benefitLabel(benefit)}</span>) : <p>Không có snapshot quyền lợi.</p>}</div>{!summary.financial.visible ? <p className={styles.permissionNote}>Giá trị chi tiêu bị ẩn vì tài khoản chưa có quyền xem tài chính.</p> : null}</div>;
}
