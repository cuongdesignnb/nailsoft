"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@nailsoft/ui-web";
import { ACTIVE_BRANCH_CHANGED_EVENT, getActiveBranchId, getAuthorizedBranchContext } from "../auth";
import {
  benefitApi,
  formatDate,
  formatMoney,
  useBenefitResource,
} from "./benefit-shared";
import styles from "./gift-card-hub.module.css";

type CreditFilters = {
  search: string;
  branchId: string;
  currency: string;
  balanceState: string;
  sourceType: string;
  activityFrom: string;
  activityTo: string;
  inactiveDays: number;
  sort: string;
  page: number;
  pageSize: number;
};

const defaultFilters: CreditFilters = {
  search: "",
  branchId: "",
  currency: "",
  balanceState: "ALL",
  sourceType: "ALL",
  activityFrom: "",
  activityTo: "",
  inactiveDays: 90,
  sort: "CUSTOMER_NAME",
  page: 1,
  pageSize: 10,
};

const sourceLabels: Record<string, string> = {
  REFUND_TO_CUSTOMER_CREDIT: "Refund → Store Credit",
  REFUND_RESTORE_ORIGINAL_CREDIT: "Hoàn lại Store Credit đã sử dụng",
  REFUND_RESTORE: "Hoàn lại Store Credit",
  SERVICE_RECOVERY: "Chăm sóc khách hàng",
  MANUAL: "Điều chỉnh thủ công",
  MANUAL_CREDIT: "Điều chỉnh tăng",
  MANUAL_DEBIT: "Điều chỉnh giảm",
  RESERVE: "Đang giữ tại POS",
  RELEASE: "Giải phóng giao dịch",
  REDEEM: "Sử dụng Store Credit",
  MIGRATION: "Khởi tạo từ hệ thống",
};

const stateLabels: Record<string, string> = {
  HAS_BALANCE: "Có số dư",
  RESERVED: "Đang được giữ tại POS",
  ZERO_BALANCE: "Hết số dư",
  DORMANT: "Lâu chưa sử dụng",
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm ngưng",
  CLOSED: "Đã đóng",
};

function readFilters(): CreditFilters {
  if (typeof window === "undefined") return defaultFilters;
  const params = new URLSearchParams(window.location.search);
  const value = { ...defaultFilters };
  for (const key of Object.keys(value) as Array<keyof CreditFilters>) {
    const raw = params.get(key);
    if (raw == null) continue;
    if (["page", "pageSize", "inactiveDays"].includes(key)) {
      (value[key] as number) = Number(raw) || Number(value[key]);
    } else {
      (value[key] as string) = raw;
    }
  }
  if (!value.branchId) value.branchId = getActiveBranchId() ?? "";
  return value;
}

function queryFor(filters: CreditFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === "ALL") continue;
    if (key === "page" && value === 1) continue;
    if (key === "pageSize" && value === 10) continue;
    if (key === "inactiveDays" && value === 90) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function stateLabel(value: unknown) {
  const key = String(value ?? "");
  return stateLabels[key] ?? sourceLabels[key] ?? key.replaceAll("_", " ");
}

function sourceLabel(value: unknown) {
  const key = String(value ?? "");
  return sourceLabels[key] ?? stateLabels[key] ?? key.replaceAll("_", " ");
}

function moneyList(entries: any[], permitted: boolean, empty = "—") {
  if (!permitted) return "Không có quyền xem";
  if (!Array.isArray(entries) || entries.length === 0) return empty;
  return entries
    .map((entry) => formatMoney(entry.amountMinor, entry.currency))
    .join(" · ");
}

function initials(value: unknown) {
  const words = String(value ?? "?").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}` : words[0]?.slice(0, 2) ?? "?").toUpperCase();
}

function Kpi({ icon, tone, label, value, detail }: { icon: string; tone: string; label: string; value: string; detail: string }) {
  return <article className={`${styles.kpi} ${styles[`kpi_${tone}`]}`}><span className={styles.kpiIcon}><Icon name={icon as any} /></span><div><span className={styles.kpiLabel}>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function CreditState({ value }: { value: string }) {
  return <span className={`${styles.badge} ${styles[`badge_${value}`] ?? ""}`}>{stateLabel(value)}</span>;
}

function EvidenceLinks({ entry }: { entry: any }) {
  const links = [
    entry.refundId ? { href: `/admin/refunds/${entry.refundId}`, label: entry.refundReference ?? "Mở Refund" } : null,
    entry.creditNoteId ? { href: `/admin/credit-notes/${entry.creditNoteId}`, label: entry.creditNoteNumber ?? "Mở Credit Note" } : null,
    entry.orderId ? { href: `/admin/pos/orders/${entry.orderId}`, label: entry.orderNumber ?? "Mở đơn POS" } : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  if (links.length === 0) return <span>—</span>;
  return <div className={styles.actionStack}>{links.map((link) => <a key={link.href} href={link.href}>{link.label} <Icon name="arrowRight" /></a>)}</div>;
}

export function CustomerCreditHub() {
  const [filters, setFilters] = useState<CreditFilters>(readFilters);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("accountId") ?? undefined);
  const [branches, setBranches] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const query = useMemo(() => queryFor(filters), [filters]);
  const directory = useBenefitResource(`/v1/customer-credit/directory${query ? `?${query}` : ""}`);
  const selected = useBenefitResource(selectedId ? `/v1/customer-credit/accounts/${encodeURIComponent(selectedId)}/overview` : null);
  const ledger = useBenefitResource(selectedId ? `/v1/customer-credit/accounts/${encodeURIComponent(selectedId)}/ledger/directory?page=1&pageSize=10&sort=NEWEST` : null);
  const data = directory.data ?? { access: { adjustmentRequest: false } };
  const items = Array.isArray(data.items) ? data.items : [];
  const summary = data.summary ?? {};
  const ready = directory.state === "ready";
  const canReadBalance = data.access?.balance !== false;
  const total = Number(data.pagination?.total ?? 0);
  const totalPages = Number(data.pagination?.totalPages ?? 0);

  useEffect(() => {
    let alive = true;
    void getAuthorizedBranchContext().then((result) => { if (alive) setBranches(result.branches); }).catch(() => undefined);
    const onBranchChange = () => setFilters((old) => ({ ...old, branchId: getActiveBranchId() ?? "", page: 1 }));
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { alive = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, []);

  useEffect(() => {
    if (!selectedId && ready && items[0]?.accountId) setSelectedId(String(items[0].accountId));
  }, [items, ready, selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(query);
    if (selectedId) next.set("accountId", selectedId); else next.delete("accountId");
    window.history.replaceState(null, "", `${window.location.pathname}${next.toString() ? `?${next}` : ""}`);
  }, [query, selectedId]);

  function update(key: keyof CreditFilters, value: string | number) {
    setFilters((old) => ({ ...old, [key]: value, ...(key === "page" ? {} : { page: 1 }) }));
  }

  function focusSearch() {
    document.getElementById("customer-credit-search")?.focus();
  }

  function clearFilters() {
    setFilters({ ...defaultFilters, branchId: getActiveBranchId() ?? "" });
  }

  async function exportDirectory() {
    setMessage("Đang tạo yêu cầu xuất báo cáo…");
    try {
      await benefitApi("/v1/stored-value/exports", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ exportType: "LIABILITY", filters: { domain: "CUSTOMER_CREDIT", ...filters } }),
      });
      setMessage("Đã tạo yêu cầu xuất dữ liệu Store Credit.");
    } catch (error: any) {
      setMessage(error?.message ?? "Không thể tạo yêu cầu xuất dữ liệu.");
    }
  }

  const selectedData = selected.data;
  const selectedAccount = selectedData?.account;
  const selectedCustomer = selectedData?.customer;
  const ledgerItems = Array.isArray(ledger.data?.items) ? ledger.data.items : [];

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><p className={styles.breadcrumb}><span>Khách hàng</span><b>/</b> Store Credit</p><h1>Store Credit</h1><p className={styles.subtitle}>Theo dõi số dư nội bộ, nguồn phát sinh và lịch sử sử dụng Store Credit của khách hàng.</p></div><div className={styles.headerActions}><button className={styles.buttonQuiet} type="button" onClick={() => void exportDirectory()}><Icon name="download" /> Xuất báo cáo</button><button className={styles.buttonQuiet} type="button" onClick={focusSearch}><Icon name="search" /> Tra cứu khách hàng</button>{data.access?.adjustmentRequest !== false ? <a className={styles.buttonPrimary} href="/admin/stored-value/adjustments"><Icon name="plus" /> Tạo điều chỉnh Credit</a> : null}</div></header>
    {message ? <p className={styles.inlineMessage} role="status">{message}</p> : null}

    <section className={styles.kpiGrid} aria-label="Tổng quan Store Credit"><Kpi icon="wallet" tone="pink" label="Khách có Store Credit" value={ready && canReadBalance ? String(summary.customerCount ?? 0) : "—"} detail={ready ? `${summary.accountCount ?? 0} tài khoản · theo tiền tệ` : "Đang tải dữ liệu"} /><Kpi icon="wallet" tone="blue" label="Tổng số dư khả dụng" value={ready ? moneyList(summary.availableByCurrency, canReadBalance) : "—"} detail="Không bao gồm khoản đang giữ" /><Kpi icon="clock" tone="amber" label="Đang được giữ tại POS" value={ready ? moneyList(summary.reservedByCurrency, canReadBalance) : "—"} detail={ready ? `${summary.pendingAdjustmentCount ?? 0} điều chỉnh chờ duyệt` : "Đang tải dữ liệu"} /><Kpi icon="chart" tone="purple" label="Đã sử dụng tháng này" value={ready ? moneyList(summary.redeemedThisPeriodByCurrency, canReadBalance) : "—"} detail={ready ? `${summary.redeemedTransactionCount ?? 0} giao dịch Redeem` : "Đang tải dữ liệu"} /><Kpi icon="gift" tone="green" label="Credit phát sinh tháng này" value={ready ? moneyList(summary.creditIssuedThisPeriodByCurrency, canReadBalance) : "—"} detail="Refund, chăm sóc và điều chỉnh đã ghi sổ" /><Kpi icon="notification" tone="coral" label="Lâu không sử dụng" value={ready && canReadBalance ? String(summary.dormantCustomerCount ?? 0) : "—"} detail={`Không có hoạt động trên ${filters.inactiveDays} ngày`} /></section>

    <section className={styles.healthCard}><div className={styles.sectionHeading}><div><h2>Nguồn Store Credit</h2><p>Chỉ hiển thị các nguồn có bằng chứng Ledger thật trong kỳ hiện tại.</p></div><span className={styles.healthLegend}>Dữ liệu tổng hợp từ máy chủ</span></div>{Array.isArray(data.sourceBreakdown) && data.sourceBreakdown.length > 0 ? <><div className={styles.healthBar}>{data.sourceBreakdown.map((entry: any) => <span key={`${entry.type}-${entry.currency}`} className={`${styles.healthSegment} ${styles.segment_ACTIVE}`} style={{ flex: Math.max(1, Number(entry.amountMinor ?? 0)) }} title={`${sourceLabel(entry.type)} · ${entry.currency}`} />)}</div><div className={styles.healthLabels}>{data.sourceBreakdown.map((entry: any) => <span key={`${entry.type}-${entry.currency}-label`}><b>{moneyList([entry], true)}</b><small>{sourceLabel(entry.type)} · {entry.count} giao dịch</small></span>)}</div></> : <div className={styles.empty}><strong>Chưa có nguồn phát sinh trong kỳ</strong><span>Dữ liệu sẽ xuất hiện khi Store Credit được ghi sổ từ Refund, POS hoặc Adjustment.</span></div>}</section>

    <section className={styles.filterCard}><div className={styles.filterGrid}><label className={styles.search}><Icon name="search" /><span>Tìm khách hàng / SĐT / giao dịch / Refund…</span><input id="customer-credit-search" value={filters.search} onChange={(event) => update("search", event.target.value)} aria-label="Tìm Store Credit" /></label><label>Chi nhánh phát sinh<select value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả trong phạm vi</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Tiền tệ<select value={filters.currency} onChange={(event) => update("currency", event.target.value)}><option value="">Tất cả tiền tệ</option><option value="VND">VND</option><option value="USD">USD</option></select></label><label>Trạng thái số dư<select value={filters.balanceState} onChange={(event) => update("balanceState", event.target.value)}><option value="ALL">Tất cả</option><option value="HAS_BALANCE">Có số dư</option><option value="RESERVED">Đang giữ tại POS</option><option value="ZERO_BALANCE">Hết số dư</option><option value="DORMANT">Lâu chưa sử dụng</option></select></label><label>Nguồn phát sinh<select value={filters.sourceType} onChange={(event) => update("sourceType", event.target.value)}><option value="ALL">Tất cả</option><option value="REFUND">Refund</option><option value="SERVICE_RECOVERY">Chăm sóc khách hàng</option><option value="MANUAL">Điều chỉnh thủ công</option></select></label></div><div className={styles.filterFooter}><div className={styles.chips}><button className={filters.balanceState === "ALL" && filters.sourceType === "ALL" ? styles.chipActive : styles.chip} type="button" onClick={() => { update("balanceState", "ALL"); update("sourceType", "ALL"); }}>Tất cả</button><button className={filters.balanceState === "HAS_BALANCE" ? styles.chipActive : styles.chip} type="button" onClick={() => update("balanceState", "HAS_BALANCE")}>Có số dư</button><button className={filters.sourceType === "REFUND" ? styles.chipActive : styles.chip} type="button" onClick={() => update("sourceType", "REFUND")}>Từ Refund</button><button className={filters.balanceState === "RESERVED" ? styles.chipActive : styles.chip} type="button" onClick={() => update("balanceState", "RESERVED")}>Đang giữ tại POS</button><button className={filters.balanceState === "DORMANT" ? styles.chipActive : styles.chip} type="button" onClick={() => update("balanceState", "DORMANT")}>Lâu chưa sử dụng</button><button className={styles.chip} type="button" onClick={() => { window.location.href = "/admin/stored-value/adjustments"; }}>Có điều chỉnh</button></div><div className={styles.filterTools}><label>Hoạt động<select value={filters.inactiveDays} onChange={(event) => update("inactiveDays", Number(event.target.value))}><option value={30}>Trên 30 ngày</option><option value={90}>Trên 90 ngày</option><option value={180}>Trên 180 ngày</option></select></label><label>Sắp xếp<select value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="CUSTOMER_NAME">Tên khách hàng</option><option value="BALANCE_DESC">Số dư cao nhất</option><option value="LAST_ACTIVITY_DESC">Hoạt động mới nhất</option><option value="LAST_ACTIVITY_ASC">Lâu chưa hoạt động</option></select></label><button className={styles.buttonQuiet} type="button" onClick={clearFilters}>Xóa bộ lọc</button></div></div></section>

    <div className={styles.workspace}><section className={styles.tableCard}><div className={styles.tableHeader}><div><h2>Danh sách Store Credit</h2><span>{total} tài khoản Customer Credit trong phạm vi truy cập</span></div><a className={styles.textLink} href="/admin/stored-value/adjustments">Xem điều chỉnh</a></div>{directory.state === "loading" ? <div className={styles.loading} role="status">Đang tải danh sách Store Credit…</div> : null}{directory.state === "forbidden" ? <div className={styles.empty} role="alert"><strong>Bạn không có quyền xem Store Credit.</strong></div> : null}{directory.state === "error" ? <div className={styles.error} role="alert">{directory.error}<button type="button" onClick={() => void directory.load()}>Thử lại</button></div> : null}{ready && items.length === 0 ? <div className={styles.empty}><strong>Chưa có khách hàng có Store Credit</strong><span>Thử xóa bộ lọc hoặc mở quy trình điều chỉnh có kiểm soát.</span><button type="button" onClick={clearFilters}>Xóa bộ lọc</button></div> : null}{ready && items.length > 0 ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Bảng danh sách Store Credit"><table><caption className={styles.srOnly}>Danh sách Store Credit</caption><thead><tr><th scope="col">Khách hàng</th><th scope="col">Tiền tệ</th><th scope="col">Số dư khả dụng</th><th scope="col">Đang giữ</th><th scope="col">Đã sử dụng ròng</th><th scope="col">Tổng Credit đã cấp</th><th scope="col">Nguồn gần nhất</th><th scope="col">Hoạt động gần nhất</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody>{items.map((account: any) => <tr key={account.accountId} className={selectedId === account.accountId ? styles.selectedRow : ""} aria-selected={selectedId === account.accountId}><td><button className={styles.cardButton} type="button" onClick={() => setSelectedId(String(account.accountId))}><strong>{account.customer.displayName}</strong><small>{account.customer.customerCode ?? "Hồ sơ khách hàng"}</small></button></td><td>{account.currency}</td><td><strong>{account.access?.balance === false ? "Không có quyền xem" : formatMoney(account.availableMinor, account.currency)}</strong></td><td>{account.access?.balance === false ? "—" : formatMoney(account.reservedMinor, account.currency)}</td><td>{account.access?.balance === false ? "—" : formatMoney(account.netRedeemedMinor, account.currency)}</td><td>{account.access?.balance === false ? "—" : formatMoney(account.lifetimeIssuedMinor, account.currency)}</td><td>{account.recentSource ? <><strong>{sourceLabel(account.recentSource.type)}</strong><small>{account.recentSource.refundReference ?? account.recentSource.orderNumber ?? "Mã giao dịch được bảo vệ"}</small></> : "—"}</td><td>{account.lastFinancialActivityAt ? formatDate(account.lastFinancialActivityAt) : "Chưa có hoạt động"}<small>{account.inactivityDays == null ? "" : `${account.inactivityDays} ngày trước`}</small></td><td><CreditState value={account.derivedState} /><small>{stateLabel(account.rawAccountStatus)}</small></td><td><button className={styles.rowAction} type="button" onClick={() => setSelectedId(String(account.accountId))}>Xem chi tiết <Icon name="arrowRight" /></button></td></tr>)}</tbody></table></div> : null}{ready && total > 0 ? <div className={styles.pagination}><span>Hiển thị {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, total)} trong {total} tài khoản</span><div><button type="button" disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)}>‹</button><b>{filters.page} / {Math.max(totalPages, 1)}</b><button type="button" disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)}>›</button><select value={filters.pageSize} aria-label="Số dòng mỗi trang" onChange={(event) => update("pageSize", Number(event.target.value))}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div> : null}</section>

      <aside className={styles.rail} aria-label="Chi tiết Store Credit">{selectedData && selectedAccount ? <><section className={styles.railCard}><div className={styles.railHeading}><div><span className={styles.eyebrow}>STORE CREDIT CỦA KHÁCH</span><h2>{selectedCustomer?.displayName}</h2></div><span className={styles.statusPill}>{selectedAccount.currency}</span></div><div className={styles.owner}><span className={styles.avatar}>{initials(selectedCustomer?.displayName)}</span><div><strong>{selectedCustomer?.displayName}</strong><small>Tài khoản Customer Credit</small></div><a href={`/admin/customers/${selectedCustomer?.id}`}>Mở hồ sơ</a></div>{selectedData.access?.balance ? <dl className={styles.detailList}><div className={styles.emphasis}><dt>Số dư khả dụng</dt><dd>{formatMoney(selectedAccount.availableMinor, selectedAccount.currency)}</dd></div><div><dt>Đang giữ tại POS</dt><dd>{formatMoney(selectedAccount.reservedMinor, selectedAccount.currency)}</dd></div><div><dt>Tổng quyền lợi còn lại</dt><dd>{formatMoney(selectedAccount.liabilityMinor, selectedAccount.currency)}</dd></div></dl> : <p className={styles.restricted}>Bạn không có quyền xem số dư Store Credit.</p>}</section><section className={styles.railCard}><h2>Tóm tắt số dư</h2>{selectedData.access?.balance ? <dl className={styles.detailList}><div><dt>Tổng Credit đã cấp</dt><dd>{formatMoney(selectedAccount.lifetimeIssuedMinor, selectedAccount.currency)}</dd></div><div><dt>Đã sử dụng ròng</dt><dd>{formatMoney(selectedAccount.redeemedMinor, selectedAccount.currency)}</dd></div><div><dt>Đang giữ</dt><dd>{formatMoney(selectedAccount.reservedMinor, selectedAccount.currency)}</dd></div><div className={styles.emphasis}><dt>Số dư hiện tại</dt><dd>{formatMoney(selectedAccount.availableMinor, selectedAccount.currency)}</dd></div></dl> : <p className={styles.restricted}>Không thể hiển thị số dư khi thiếu quyền truy cập.</p>}</section><section className={styles.railCard}><h2>Nguồn Credit gần đây</h2>{selectedData.recentSources?.length ? <div className={styles.miniLedger}>{selectedData.recentSources.slice(0, 5).map((entry: any) => <div key={entry.id}><span className={styles.ledgerDot} /><div><strong>{sourceLabel(entry.displayType)}</strong><small>{formatDate(entry.occurredAt)} · {entry.refundReference ?? entry.orderNumber ?? "Mã giao dịch được bảo vệ"}</small></div><b>{entry.availableDeltaMinor && entry.availableDeltaMinor !== "0" ? formatMoney(entry.availableDeltaMinor, selectedAccount.currency) : "—"}</b></div>)}</div> : <p className={styles.restricted}>Chưa có nguồn Credit gần đây.</p>}</section><section className={styles.railCard}><h2>Kiểm tra sử dụng</h2><p className={styles.helper}>Store Credit chỉ được giữ và sử dụng sau khi POS kiểm tra đủ điều kiện theo cùng Stored Value engine.</p>{selectedData.access?.eligibility ? <div className={styles.actionStack}><a href="/admin/pos/orders">Kiểm tra tại POS <Icon name="arrowRight" /></a></div> : <p className={styles.restricted}>Bạn không có quyền kiểm tra điều kiện tại POS.</p>}</section><section className={styles.railCard}><h2>Bằng chứng nguồn</h2>{selectedData.recentSources?.[0] ? <EvidenceLinks entry={selectedData.recentSources[0]} /> : <p className={styles.restricted}>Chưa có chứng từ liên quan.</p>}</section>{selectedData.pendingAdjustments?.length ? <section className={styles.railCard}><h2>Điều chỉnh chờ duyệt</h2><div className={styles.miniLedger}>{selectedData.pendingAdjustments.map((adjustment: any) => <div key={adjustment.id}><span className={styles.ledgerDot} /><div><strong>{stateLabel(adjustment.adjustmentType)}</strong><small>{formatDate(adjustment.createdAt)} · {adjustment.reasonCode}</small></div><b>{formatMoney(adjustment.amountMinor, adjustment.currency)}</b></div>)}</div><div className={styles.actionStack}><a href="/admin/stored-value/adjustments">Mở quy trình điều chỉnh <Icon name="arrowRight" /></a></div></section> : null}</> : <section className={styles.railCard}><div className={styles.empty}><Icon name="wallet" /><strong>Chọn một tài khoản Store Credit</strong><span>Chọn một dòng để xem dữ liệu server.</span></div></section>}</aside>
    </div>

    {selectedId && selectedData ? <section className={styles.tableCard} style={{ maxWidth: "1560px", margin: "14px auto 0" }}><div className={styles.tableHeader}><div><span className={styles.eyebrow}>LỊCH SỬ TỪ MÁY CHỦ</span><h2>Lịch sử Store Credit</h2><span>Số dư chạy được tính trên toàn bộ lịch sử, không theo riêng trang hiện tại.</span></div>{selectedData.access?.ledger ? <a className={styles.textLink} href={`/admin/customer-credit?accountId=${selectedId}`}>Đang xem tài khoản</a> : null}</div>{!selectedData.access?.ledger ? <p className={styles.restricted}>Bạn không có quyền xem lịch sử số dư.</p> : ledger.state === "loading" ? <div className={styles.loading}>Đang tải lịch sử Store Credit…</div> : ledger.state === "error" ? <div className={styles.error}>{ledger.error}</div> : <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Lịch sử Store Credit có thể cuộn"><table><caption className={styles.srOnly}>Lịch sử Store Credit</caption><thead><tr><th scope="col">Thời gian</th><th scope="col">Loại</th><th scope="col">Nguồn</th><th scope="col">Thay đổi khả dụng</th><th scope="col">Số dư khả dụng sau</th><th scope="col">Đang giữ sau</th><th scope="col">Quyền lợi sau</th><th scope="col">Chứng từ</th><th scope="col">Người thực hiện</th></tr></thead><tbody>{ledgerItems.map((entry: any) => <tr key={entry.id}><td>{formatDate(entry.occurredAt)}</td><td><strong>{sourceLabel(entry.displayType)}</strong><small>{sourceLabel(entry.entryType)}</small></td><td>{entry.source?.refundDestination ? sourceLabel(entry.displayType) : entry.orderNumber ? "POS" : entry.adjustmentRequestId ? "Điều chỉnh" : "Sổ giao dịch"}</td><td>{entry.availableDeltaMinor && entry.availableDeltaMinor !== "0" ? formatMoney(entry.availableDeltaMinor, entry.currency) : "—"}</td><td>{formatMoney(entry.availableAfterMinor, entry.currency)}</td><td>{formatMoney(entry.reservedAfterMinor, entry.currency)}</td><td>{formatMoney(entry.liabilityAfterMinor, entry.currency)}</td><td>{entry.refundReference ?? entry.creditNoteNumber ?? entry.orderNumber ?? entry.invoiceNumber ?? entry.paymentReference ?? "—"}</td><td>{entry.actorDisplayName ?? "—"}</td></tr>)}</tbody></table></div>}</section> : null}
  </main>;
}
