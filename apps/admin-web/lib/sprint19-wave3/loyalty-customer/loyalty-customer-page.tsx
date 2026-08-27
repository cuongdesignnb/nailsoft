/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authorizedFetch } from "../../auth";
import styles from "./loyalty-customer-page.module.css";

type LoadState = "loading" | "ready" | "empty" | "forbidden" | "error";
type Filters = {
  search: string;
  from: string;
  to: string;
  group: string;
  sign: string;
  source: string;
  displayStatus: string;
  sort: string;
  page: number;
  pageSize: number;
};

const initialFilters: Filters = {
  search: "",
  from: "",
  to: "",
  group: "ALL",
  sign: "ALL",
  source: "ALL",
  displayStatus: "ALL",
  sort: "NEWEST",
  page: 1,
  pageSize: 10,
};

function initials(name: unknown) {
  const value = String(name ?? "?").trim();
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase() || "?";
}

function point(value: unknown) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function signedPoint(value: unknown) {
  const number = Number(value ?? 0);
  return `${number > 0 ? "+" : ""}${point(number)} điểm`;
}

function dateTime(value: unknown) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(String(value)));
}

function dateOnly(value: unknown) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(String(value)));
}

function localizedName(value: any, fallback = "Chương trình đang áp dụng") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value["vi-VN"] ?? value["en-US"] ?? value.name ?? value.code ?? fallback;
}

function transactionReference(value: any) {
  return value?.reference ?? value?.sourceReference ?? "Mã giao dịch được bảo vệ";
}

function statusClass(status: string) {
  if (status === "PENDING") return `${styles.status} ${styles.statusPending}`;
  if (status === "RELEASED") return `${styles.status} ${styles.statusReleased}`;
  if (status === "EXPIRED") return `${styles.status} ${styles.statusExpired}`;
  return `${styles.status} ${styles.statusRecorded}`;
}

async function api(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body?.error ?? body;
    throw Object.assign(new Error(error?.message ?? "Không thể tải dữ liệu Loyalty."), {
      forbidden: response.status === 401 || response.status === 403,
      code: error?.code,
    });
  }
  return body?.data ?? body;
}

function sourceHref(kind: string, id: string) {
  if (kind === "POS_ORDER") return `/admin/pos/orders/${encodeURIComponent(id)}`;
  if (kind === "INVOICE") return `/admin/financial/invoices?invoiceId=${encodeURIComponent(id)}`;
  if (kind === "REFUND") return `/admin/refunds/${encodeURIComponent(id)}`;
  if (kind === "CREDIT_NOTE") return `/admin/credit-notes/${encodeURIComponent(id)}`;
  return null;
}

export default function LoyaltyCustomerPage({ customerId }: { customerId: string }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [overviewState, setOverviewState] = useState<LoadState>("loading");
  const [overview, setOverview] = useState<any>(null);
  const [membership, setMembership] = useState<any>(null);
  const [membershipState, setMembershipState] = useState<LoadState>("loading");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [ledgerState, setLedgerState] = useState<LoadState>("loading");
  const [ledger, setLedger] = useState<any>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detailState, setDetailState] = useState<LoadState>("empty");
  const [detail, setDetail] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [exportMessage, setExportMessage] = useState("");
  const [exportState, setExportState] = useState<"idle" | "sending">("idle");

  useEffect(() => {
    let active = true;
    setOverviewState("loading");
    setMembershipState("loading");
    void Promise.allSettled([
      api(`/v1/customers/${encodeURIComponent(customerId)}/loyalty/overview`),
      api(`/v1/customers/${encodeURIComponent(customerId)}/membership`),
    ]).then(([overviewResult, membershipResult]) => {
      if (!active) return;
      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
        setOverviewState("ready");
      } else {
        setOverviewState((overviewResult.reason as any)?.forbidden ? "forbidden" : "error");
      }
      if (membershipResult.status === "fulfilled") {
        setMembership(membershipResult.value);
        setMembershipState("ready");
      } else {
        setMembershipState((membershipResult.reason as any)?.forbidden ? "forbidden" : "error");
      }
    });
    return () => { active = false; };
  }, [customerId]);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      group: filters.group,
      sign: filters.sign,
      source: filters.source,
      displayStatus: filters.displayStatus,
      sort: filters.sort,
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.search) params.set("search", filters.search);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    setLedgerState("loading");
    void api(`/v1/customers/${encodeURIComponent(customerId)}/loyalty/ledger/directory?${params.toString()}`)
      .then((value) => {
        if (!active) return;
        setLedger(value);
        setLedgerState("ready");
        const first = value?.items?.[0]?.id ?? "";
        setSelectedId((previous) => value?.items?.some((item: any) => item.id === previous) ? previous : first);
      })
      .catch((error: any) => {
        if (!active) return;
        setLedgerState(error?.forbidden ? "forbidden" : "error");
      });
    return () => { active = false; };
    // filterKey keeps the request tied to the complete server-side filter state.
  }, [customerId, filterKey]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailState("empty"); return; }
    let active = true;
    setDetailState("loading");
    void api(`/v1/customers/${encodeURIComponent(customerId)}/loyalty/ledger/${encodeURIComponent(selectedId)}`)
      .then((value) => { if (active) { setDetail(value); setDetailState("ready"); } })
      .catch((error: any) => { if (active) setDetailState(error?.forbidden ? "forbidden" : "error"); });
    return () => { active = false; };
  }, [customerId, selectedId]);

  useEffect(() => {
    const term = customerSearch.trim();
    if (term.length < 2) { setCustomerResults([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void api(`/v1/customers?search=${encodeURIComponent(term)}&limit=10`)
        .then((value) => { if (active) setCustomerResults(Array.isArray(value) ? value : value?.items ?? []); })
        .catch(() => { if (active) setCustomerResults([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [customerSearch]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value, ...(key === "page" ? {} : { page: 1 }) }));
  }

  function selectTab(group: string) {
    setFilter("group", group);
  }

  async function requestExport() {
    setExportState("sending");
    setExportMessage("");
    try {
      const result = await api("/v1/benefits/exports", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ exportType: "LOYALTY", filters: { customerId, ...filters } }),
      });
      setExportMessage(result?.status === "READY" ? "Tệp đã sẵn sàng." : "Đã tạo yêu cầu xuất lịch sử; hệ thống sẽ xử lý nền.");
    } catch (error: any) {
      setExportMessage(error?.message ?? "Không thể tạo yêu cầu xuất.");
    } finally {
      setExportState("idle");
    }
  }

  const account = overview?.account;
  const customer = overview?.customer;
  const summary = ledger?.summary ?? overview?.stats;
  const items = ledger?.items ?? [];
  const page = ledger?.pagination;
  const tabs: Array<[string, string]> = [
    ["ALL", "Tất cả giao dịch"],
    ["EARN", "Tích điểm"],
    ["REDEEM", "Sử dụng điểm"],
    ["MANUAL_ADJUSTMENT", "Điều chỉnh"],
    ["EXPIRE", "Hết hạn"],
    ["PENDING", "Đang chờ"],
  ];

  if (overviewState === "forbidden") {
    return <main className={styles.page}><div className={styles.card}><div className={styles.permission}>Bạn không có quyền xem tài khoản Loyalty của khách hàng này.</div></div></main>;
  }

  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Đường dẫn"><a href="/admin/customers">Khách hàng</a><span>/</span><a href={`/admin/loyalty/customers/${encodeURIComponent(customerId)}`}>Loyalty</a><span>/</span><span>Lịch sử điểm</span></nav>

    <header className={styles.heading}>
      <div><h1>Loyalty &amp; lịch sử điểm</h1><p>Theo dõi điểm tích lũy, điểm đã sử dụng, điều chỉnh và thời hạn của khách hàng.</p></div>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={() => void requestExport()} disabled={exportState === "sending"}>↧ &nbsp;Xuất lịch sử</button>
        <a className={styles.button} href="/admin/loyalty/programs">♢ &nbsp;Quản lý chính sách</a>
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => searchRef.current?.focus()}>⌕ &nbsp;Tra cứu khách hàng</button>
      </div>
    </header>

    <section className={`${styles.card} ${styles.selector}`} aria-label="Chọn khách hàng">
      <span className={styles.selectorLabel}>Khách hàng</span>
      <div className={styles.selectorSearch}>
        <input ref={searchRef} className={styles.input} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tìm theo tên, số điện thoại hoặc mã khách hàng" aria-label="Tìm khách hàng" autoComplete="off" />
        {customerResults.length ? <div className={styles.suggestions} role="listbox">{customerResults.map((item: any) => <button className={styles.suggestion} key={item.id} type="button" onClick={() => { window.location.assign(`/admin/loyalty/customers/${encodeURIComponent(item.id)}`); }}><span><strong>{item.displayName}</strong><small>{item.phone ?? item.email ?? item.id}</small></span><small>{item.id}</small></button>)}</div> : null}
      </div>
      <div className={styles.selectedCustomer}><span className={styles.avatar}>{initials(customer?.displayName)}</span><span><strong>{customer?.displayName ?? "Đang tải hồ sơ khách hàng"}</strong><small>{customer?.phone ?? customer?.email ?? customerId}</small></span></div>
    </section>

    {overviewState === "error" ? <div className={styles.notice}>Không thể tải tổng quan tài khoản Loyalty. Thử tải lại trang để kiểm tra quyền hoặc kết nối.</div> : null}
    <section className={`${styles.card} ${styles.hero}`} aria-label="Tổng quan Loyalty">
      <div className={styles.customerHero}><span className={styles.avatar}>{initials(customer?.displayName)}</span><div><h2>{customer?.displayName ?? "Đang tải..."}</h2><p>{customer?.phone ?? customer?.email ?? customerId}</p><div className={styles.customerMeta}><span className={styles.tag}>Loyalty</span>{membershipState === "ready" && membership?.tierName ? <span className={styles.tag}>{localizedName(membership.tierName)}</span> : null}</div></div></div>
      <dl className={styles.metric}><dt>Điểm khả dụng</dt><dd>{point(account?.availablePoints)} điểm</dd></dl>
      <dl className={`${styles.metric} ${styles.metricAccent}`}><dt>Điểm có thể dùng</dt><dd>{point(account?.spendablePoints)} điểm</dd></dl>
      <dl className={`${styles.metric} ${styles.metricPurple}`}><dt>Điểm đang giữ</dt><dd>{point(account?.reservedPoints)} điểm</dd></dl>
      <dl className={styles.metric}><dt>Đang chờ ghi nhận</dt><dd>{point(account?.pendingPoints)} điểm</dd></dl>
      <dl className={`${styles.metric} ${styles.metricGreen}`}><dt>Tổng điểm đã tích</dt><dd>{point(account?.lifetimeEarnedPoints)} điểm</dd></dl>
    </section>

    <section className={styles.card} aria-label="Bộ lọc lịch sử điểm">
      <div className={styles.tabBar} role="tablist" aria-label="Nhóm giao dịch">{tabs.map(([group, label]) => <button className={styles.tab} role="tab" aria-selected={filters.group === group} key={group} type="button" onClick={() => selectTab(group)}>{label}</button>)}</div>
      <div className={styles.filters}>
        <div className={styles.field}><label htmlFor="loyalty-ledger-search">Tìm trong lịch sử</label><input id="loyalty-ledger-search" className={styles.input} value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Mã giao dịch, nguồn, ghi chú..." /></div>
        <div className={styles.field}><label htmlFor="loyalty-ledger-from">Từ ngày</label><input id="loyalty-ledger-from" className={styles.input} type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></div>
        <div className={styles.field}><label htmlFor="loyalty-ledger-to">Đến ngày</label><input id="loyalty-ledger-to" className={styles.input} type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></div>
        <div className={styles.field}><label htmlFor="loyalty-ledger-sign">Dấu điểm</label><select id="loyalty-ledger-sign" className={styles.select} value={filters.sign} onChange={(event) => setFilter("sign", event.target.value)}><option value="ALL">Tất cả</option><option value="POSITIVE">Điểm cộng</option><option value="NEGATIVE">Điểm trừ</option></select></div>
        <div className={styles.field}><label htmlFor="loyalty-ledger-source">Nguồn</label><select id="loyalty-ledger-source" className={styles.select} value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="ALL">Tất cả nguồn</option><option value="POS">Đơn POS</option><option value="INVOICE">Hóa đơn</option><option value="REFUND">Hoàn tiền</option><option value="MANUAL">Thủ công</option><option value="SYSTEM">Hệ thống</option></select></div>
        <div className={styles.field}><label htmlFor="loyalty-ledger-status">Trạng thái</label><select id="loyalty-ledger-status" className={styles.select} value={filters.displayStatus} onChange={(event) => setFilter("displayStatus", event.target.value)}><option value="ALL">Tất cả</option><option value="PENDING">Đang chờ</option><option value="RECORDED">Đã ghi nhận</option><option value="RELEASED">Đã hoàn giữ</option><option value="EXPIRED">Đã hết hạn</option></select></div>
        <div className={styles.filterActions}><button className={styles.button} type="button" onClick={() => setFilters(initialFilters)}>Đặt lại</button><select className={`${styles.select} ${styles.pageButton}`} aria-label="Sắp xếp" value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option></select></div>
      </div>
    </section>

    <div className={styles.layout}>
      <section className={`${styles.card} ${styles.tableCard}`} aria-labelledby="ledger-title">
        <div className={styles.sectionHeading}><div><h2 id="ledger-title">Lịch sử điểm Loyalty</h2><p>{summary?.transactionCount ?? 0} giao dịch trong phạm vi đang lọc</p></div><div className={styles.exportNotice} role="status">{exportMessage}</div></div>
        {ledgerState === "loading" ? <div className={styles.loading} role="status">Đang tải lịch sử điểm...</div> : null}
        {ledgerState === "forbidden" ? <div className={styles.permission}>Bạn không có quyền xem sổ điểm.</div> : null}
        {ledgerState === "error" ? <div className={styles.notice}>Không thể tải sổ điểm. Kiểm tra lại bộ lọc hoặc thử lại.</div> : null}
        {ledgerState === "ready" && !items.length ? <div className={styles.empty}>Chưa có giao dịch Loyalty phù hợp với bộ lọc hiện tại.</div> : null}
        {ledgerState === "ready" && items.length ? <div className={styles.ledgerWrap}><table className={styles.table}><caption className={styles.srOnly}>Lịch sử điểm Loyalty của khách hàng</caption><thead><tr><th scope="col">Thời gian</th><th scope="col">Giao dịch</th><th scope="col">Loại</th><th scope="col">Nguồn</th><th scope="col">Điểm thay đổi</th><th scope="col">Số dư sau</th><th scope="col">Hết hạn</th><th scope="col">Trạng thái</th></tr></thead><tbody>{items.map((item: any) => <tr key={item.id} aria-selected={selectedId === item.id} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(item.id); } }} tabIndex={0}><td><span className={styles.strong}>{dateTime(item.createdAt)}</span></td><td><span className={styles.strong}>{transactionReference(item)}</span><span className={styles.sub}>{item.generationKey ?? "Sổ điểm"}</span></td><td><span className={styles.strong}>{item.displayType}</span><span className={styles.sub}>{item.primaryBucket}</span></td><td><span className={styles.strong}>{item.source?.label ?? "—"}</span><span className={styles.sub}>{item.source?.label ?? "Nguồn hệ thống"}</span></td><td><span className={Number(item.primaryDelta) >= 0 ? styles.deltaPositive : styles.deltaNegative}>{signedPoint(item.primaryDelta)}</span></td><td><span className={styles.strong}>{point(item.balances?.after?.available)} điểm</span><span className={styles.sub}>Dùng được {point(item.balances?.after?.spendable)}</span></td><td className={styles.muted}>{dateOnly(item.expiresAt)}</td><td><span className={statusClass(item.displayStatus)}>{item.displayStatus === "PENDING" ? "Đang chờ" : item.displayStatus === "RELEASED" ? "Đã hoàn giữ" : item.displayStatus === "EXPIRED" ? "Đã hết hạn" : "Đã ghi nhận"}</span></td></tr>)}</tbody></table></div> : null}
        {ledgerState === "ready" && page ? <div className={styles.pagination}><span>Hiển thị {items.length ? (page.page - 1) * page.pageSize + 1 : 0}–{Math.min(page.page * page.pageSize, page.total)} trong {page.total} giao dịch</span><div className={styles.paginationControls}><button className={`${styles.button} ${styles.pageButton}`} type="button" aria-label="Trang trước" disabled={page.page <= 1} onClick={() => setFilter("page", page.page - 1)}>‹</button><span>Trang {page.page} / {page.totalPages}</span><button className={`${styles.button} ${styles.pageButton}`} type="button" aria-label="Trang sau" disabled={page.page >= page.totalPages} onClick={() => setFilter("page", page.page + 1)}>›</button></div></div> : null}
      </section>

      <aside className={styles.side} aria-label="Chi tiết Loyalty">
        <section className={`${styles.card} ${styles.sideCard}`}><h2>Chi tiết giao dịch</h2>{detailState === "loading" ? <div className={styles.loading}>Đang tải...</div> : null}{detailState === "forbidden" ? <div className={styles.permission}>Không có quyền xem chi tiết.</div> : null}{detailState === "error" ? <div className={styles.notice}>Không thể tải chi tiết giao dịch.</div> : null}{detailState === "empty" ? <div className={styles.empty}>Chọn một giao dịch để xem chi tiết.</div> : null}{detailState === "ready" && detail ? <><p className={styles.detailTitle}>{transactionReference(detail)} · {detail.displayType}</p><p className={styles.detailMeta}>{dateTime(detail.createdAt)} · {transactionReference(detail)}</p><div className={styles.detailBlock}><dl className={styles.sideList}><div><dt>Điểm thay đổi</dt><dd className={Number(detail.primaryDelta) >= 0 ? styles.deltaPositive : styles.deltaNegative}>{signedPoint(detail.primaryDelta)}</dd></div><div><dt>Số dư trước</dt><dd>{point(detail.balances?.before?.available)} điểm</dd></div><div><dt>Số dư sau</dt><dd>{point(detail.balances?.after?.available)} điểm</dd></div><div><dt>Có thể dùng sau</dt><dd>{point(detail.balances?.after?.spendable)} điểm</dd></div><div><dt>Trạng thái</dt><dd><span className={statusClass(detail.displayStatus)}>{detail.displayStatus}</span></dd></div></dl></div><div className={styles.detailBlock}><h3>Nguồn phát sinh</h3><p className={styles.detailMeta}>{detail.source?.label ?? "Hệ thống"}</p><div className={styles.sourceLinks}>{[detail.source?.posOrder, detail.source?.invoice, detail.source?.refund, detail.source?.creditNote].filter(Boolean).map((source: any) => { const href = source?.id ? sourceHref(source.kind, String(source.id)) : null; return href ? <a className={styles.sourceLink} href={href} key={source.kind}>{source.reference} ↗</a> : null; })}</div></div><div className={styles.detailBlock}><h3>Người ghi nhận</h3><p className={styles.detailMeta}>{detail.actor?.displayName ?? "Hệ thống"}</p></div></> : null}</section>
        <section className={`${styles.card} ${styles.sideCard}`}><h3>Tóm tắt kỳ điểm</h3><dl className={styles.sideList}><div><dt>Điểm tích trong kỳ</dt><dd className={styles.deltaPositive}>{point(overview?.stats?.monthEarnedPoints ?? 0)}</dd></div><div><dt>Đã sử dụng</dt><dd>{point(overview?.stats?.redeemedPoints ?? 0)}</dd></div><div><dt>Đã hết hạn</dt><dd>{point(overview?.stats?.expiredPoints ?? 0)}</dd></div><div><dt>Điều chỉnh</dt><dd>{point(overview?.stats?.adjustmentPoints ?? 0)}</dd></div></dl></section>
        <section className={`${styles.card} ${styles.sideCard}`}><h3>Chính sách đang áp dụng</h3>{overview?.program ? <><p className={styles.strong}>{localizedName(overview.program.name, overview.program.code ?? "Chương trình đang áp dụng")}</p><p className={styles.detailMeta}>Hiệu lực từ {dateOnly(overview.program.effectiveFrom)}{overview.program.effectiveTo ? ` đến ${dateOnly(overview.program.effectiveTo)}` : ""}</p></> : <p className={styles.detailMeta}>Không có chương trình đang hiệu lực theo thời gian hiện tại.</p>}{membershipState === "forbidden" ? <p className={styles.detailMeta}>Thông tin hạng thành viên bị giới hạn theo quyền truy cập.</p> : null}</section>
      </aside>
    </div>

    <div className={styles.lowerGrid}><section className={`${styles.card} ${styles.expiry}`}><div className={styles.sectionHeading} style={{ padding: 0 }}><div><h2>Điểm sắp hết hạn</h2><p>Chỉ hiển thị lot có ngày hết hạn thật từ hệ thống.</p></div>{overview?.expiry?.nearest ? <span className={styles.tag}>{point(overview.expiry.nearest.points)} điểm</span> : null}</div>{overview?.expiry?.buckets?.map((bucket: any) => <div className={styles.expiryRow} key={bucket.days}><span>{bucket.days} ngày</span><div className={styles.progress}><span style={{ width: `${Math.min(Number(bucket.points) / Math.max(Number(account?.availablePoints ?? 1), 1) * 100, 100)}%` }} /></div><strong>{point(bucket.points)}</strong></div>)}{!overview?.expiry?.buckets?.length ? <p className={styles.detailMeta}>Chưa có điểm nào có ngày hết hạn.</p> : null}</section><section className={`${styles.card} ${styles.expiry}`}><h2>Chỉ số sổ điểm</h2><dl className={styles.sideList} style={{ marginTop: 14 }}><div><dt>Tổng giao dịch</dt><dd>{summary?.transactionCount ?? 0}</dd></div><div><dt>Điểm cộng theo bộ lọc</dt><dd className={styles.deltaPositive}>{point(summary?.positivePoints ?? 0)}</dd></div><div><dt>Điểm trừ theo bộ lọc</dt><dd className={styles.deltaNegative}>{point(summary?.negativePoints ?? 0)}</dd></div><div><dt>Trạng thái dữ liệu</dt><dd>Server authoritative</dd></div></dl></section></div>
  </main>;
}
