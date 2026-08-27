"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  getActiveBranchId,
  getAuthorizedBranchContext,
} from "../auth";
import {
  benefitApi,
  formatDate,
  formatInteger,
  useBenefitResource,
} from "./benefit-shared";
import styles from "./customer-care-hub.module.css";

type CustomerCareHubProps = { customerId?: string };
type CareFilters = {
  search: string;
  branchId: string;
  activityType: string;
  status: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  sort: string;
};

const defaultFilters: CareFilters = {
  search: "",
  branchId: "",
  activityType: "ALL",
  status: "ALL",
  from: "",
  to: "",
  page: 1,
  pageSize: 10,
  sort: "NEWEST",
};

const activityLabels: Record<string, string> = {
  EMAIL: "Email",
  CALL: "Cuộc gọi",
  INTERNAL_NOTE: "Ghi chú nội bộ",
  FOLLOW_UP: "Follow-up",
  SERVICE_RECOVERY: "Service Recovery",
};

const statusLabels: Record<string, string> = {
  SUCCESS: "Đã ghi nhận",
  SENT: "Đã gửi",
  PENDING: "Đang chờ",
  SCHEDULED: "Đã lên lịch",
  PROCESSING: "Đang gửi",
  FAILED: "Thất bại",
  DEAD_LETTER: "Không thể gửi",
  SUPPRESSED: "Đã chặn gửi",
  CANCELLED: "Đã hủy",
  OVERDUE: "Quá hạn",
  OPEN: "Đang mở",
  IN_PROGRESS: "Đang xử lý",
  COMPLETED: "Hoàn tất",
  RECORDED: "Đã ghi nhận",
};

function readFilters() {
  if (typeof window === "undefined") return defaultFilters;
  const params = new URLSearchParams(window.location.search);
  const result = { ...defaultFilters };
  for (const key of Object.keys(result) as Array<keyof CareFilters>) {
    const value = params.get(key);
    if (value == null) continue;
    if (["page", "pageSize"].includes(key)) {
      result[key] = (Number(value) || result[key]) as never;
    } else {
      result[key] = value as never;
    }
  }
  if (!result.branchId) result.branchId = getActiveBranchId() ?? "";
  return result;
}

function buildQuery(filters: CareFilters, customerId?: string) {
  const params = new URLSearchParams();
  const values = { ...filters, ...(customerId ? { customerId } : {}) };
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === "ALL") continue;
    if (key === "page" && value === 1) continue;
    if (key === "pageSize" && value === 10) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function buildOverviewQuery(filters: CareFilters, customerId?: string) {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (customerId) params.set("customerId", customerId);
  return params.toString();
}

function label(value: unknown, fallback = "—") {
  if (value == null || value === "") return fallback;
  const key = String(value).toUpperCase();
  return activityLabels[key] ?? statusLabels[key] ?? key.replaceAll("_", " ");
}

function initials(value: unknown) {
  const words = String(value ?? "?").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1
    ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
    : words[0]?.slice(0, 2) ?? "?").toUpperCase();
}

function statusTone(value: unknown) {
  const key = String(value ?? "").toUpperCase();
  if (["SUCCESS", "SENT", "RECORDED", "COMPLETED"].includes(key)) return styles.toneSuccess;
  if (["FAILED", "DEAD_LETTER", "OVERDUE"].includes(key)) return styles.toneDanger;
  if (["SUPPRESSED", "CANCELLED"].includes(key)) return styles.toneMuted;
  if (["PENDING", "SCHEDULED", "PROCESSING", "OPEN", "IN_PROGRESS"].includes(key)) return styles.toneWarning;
  return styles.toneInfo;
}

function Kpi({ icon, labelText, value, helper, tone }: { icon: any; labelText: string; value: string; helper: string; tone: string | undefined }) {
  return (
    <article className={`${styles.kpi} ${tone ?? ""}`}>
      <span className={styles.kpiIcon}><Icon name={icon} /></span>
      <div><span>{labelText}</span><strong>{value}</strong><small>{helper}</small></div>
    </article>
  );
}

function DetailLinks({ related }: { related: any }) {
  const links = [
    related?.appointmentId ? { href: `/admin/appointments/${related.appointmentId}`, text: "Mở lịch hẹn" } : null,
    related?.campaignId ? { href: `/admin/marketing/campaigns/${related.campaignId}`, text: "Mở chiến dịch" } : null,
    related?.reviewRequestId ? { href: `/admin/review-requests/${related.reviewRequestId}`, text: "Mở review request" } : null,
    related?.caseId ? { href: `/admin/service-recovery/${related.caseId}`, text: "Mở Service Recovery" } : null,
  ].filter(Boolean) as Array<{ href: string; text: string }>;
  if (!links.length) return <p className={styles.muted}>Không có liên kết liên quan.</p>;
  return <div className={styles.linkStack}>{links.map((item) => <a href={item.href} key={item.href}>{item.text}<Icon name="arrowRight" /></a>)}</div>;
}

function ConsentCard({ detail }: { detail: any }) {
  const preferences = detail?.consentContext?.preferences;
  const consents = Array.isArray(detail?.consentContext?.consents) ? detail.consentContext.consents : [];
  const stateFor = (purpose: string) => consents.find((item: any) => item.purpose === purpose)?.state;
  const rows = [
    ["Email giao dịch", preferences?.emailStatus ? `Email ${String(preferences.emailStatus).toLowerCase()}` : "Chưa có dữ liệu"],
    ["Marketing Email", stateFor("MARKETING_EMAIL") ?? "Chưa có dữ liệu"],
    ["Review Request", stateFor("REVIEW_REQUEST") ?? "Chưa có dữ liệu"],
    ["Service Recovery", stateFor("SERVICE_RECOVERY") ?? "Chưa có dữ liệu"],
  ];
  return <section className={styles.railCard}><div className={styles.cardTitle}><Icon name="shield" /><h2>Quyền liên hệ</h2></div><p className={styles.notice}>Chỉ gửi nội dung marketing khi khách có consent phù hợp.</p><dl className={styles.compactList}>{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{label(value)}</dd></div>)}</dl></section>;
}

function ActivityDetail({ detail, loading }: { detail: any; loading: boolean }) {
  if (loading) return <div className={styles.panelState}>Đang tải chi tiết hoạt động…</div>;
  if (!detail) return <div className={styles.emptyInspector}><Icon name="activity" /><strong>Chọn một hoạt động</strong><span>Chi tiết email, cuộc gọi, ghi chú hoặc follow-up sẽ hiển thị tại đây.</span></div>;
  const message = detail.message;
  const activity = detail.activity;
  const followup = detail.followup;
  const recovery = detail.recovery;
  return <>
    {detail.customer ? <section className={styles.railCard}><div className={styles.customerHero}><span className={styles.avatar}>{initials(detail.customer.displayName)}</span><div><span className={styles.eyebrow}>KHÁCH HÀNG</span><h2>{detail.customer.displayName}</h2><small>{detail.customer.phoneMasked ?? "Thông tin liên hệ được giới hạn"}</small></div></div><a className={styles.outlineAction} href={`/admin/customers/${detail.customer.id}`}>Mở hồ sơ khách hàng<Icon name="externalLink" /></a></section> : null}
    <section className={styles.railCard}><div className={styles.cardTitle}><Icon name={message ? "file" : activity?.type === "CALL" ? "phone" : "activity"} /><h2>{message ? "Chi tiết email" : followup ? "Chi tiết follow-up" : recovery ? "Chi tiết Service Recovery" : "Chi tiết hoạt động"}</h2></div>{message ? <><dl className={styles.compactList}><div><dt>Loại</dt><dd>{label(message.purpose)}</dd></div><div><dt>Trạng thái</dt><dd><span className={`${styles.badge} ${statusTone(message.status)}`}>{label(message.status)}</span></dd></div><div><dt>Ngày tạo</dt><dd>{formatDate(message.createdAt)}</dd></div><div><dt>Ngày gửi</dt><dd>{formatDate(message.sentAt)}</dd></div><div><dt>Số lần thử</dt><dd>{message.attemptCount ?? 0}</dd></div></dl>{message.subject ? <div className={styles.subject}><span>Tiêu đề</span><strong>{message.subject}</strong></div> : null}<div className={styles.timeline}>{(message.attempts ?? []).map((attempt: any) => <div key={`${attempt.attemptNumber}-${attempt.createdAt}`}><span className={styles.timelineDot} /><div><strong>Lần gửi {attempt.attemptNumber}</strong><small>{formatDate(attempt.createdAt)} · {label(attempt.result)}</small>{attempt.safeErrorCode ? <small className={styles.errorText}>{attempt.safeErrorCode}</small> : null}</div></div>)}</div><DetailLinks related={message ? { appointmentId: detail.related?.appointmentId, campaignId: detail.related?.campaignId, reviewRequestId: detail.related?.reviewRequestId } : null} /></> : null}{activity ? <><dl className={styles.compactList}><div><dt>Loại hoạt động</dt><dd>{label(activity.type)}</dd></div><div><dt>Thời gian</dt><dd>{formatDate(activity.occurredAt)}</dd></div><div><dt>Kết quả</dt><dd>{label(activity.outcomeCode ?? "RECORDED")}</dd></div><div><dt>Người thực hiện</dt><dd>{activity.actor?.displayName ?? "—"}</dd></div></dl><p className={styles.detailText}>{activity.summary}</p><DetailLinks related={activity.related?.type === "SERVICE_RECOVERY_CASE" ? { caseId: activity.related.id } : null} /></> : null}{followup ? <><dl className={styles.compactList}><div><dt>Lý do</dt><dd>{followup.reason}</dd></div><div><dt>Đến hạn</dt><dd>{formatDate(followup.dueAt)}</dd></div><div><dt>Mức độ</dt><dd>{label(followup.priority)}</dd></div><div><dt>Trạng thái</dt><dd><span className={`${styles.badge} ${statusTone(followup.derivedStatus)}`}>{label(followup.derivedStatus)}</span></dd></div></dl>{followup.note ? <p className={styles.detailText}>{followup.note}</p> : null}</> : null}{recovery ? <><dl className={styles.compactList}><div><dt>Trạng thái case</dt><dd>{label(recovery.status)}</dd></div><div><dt>Mức độ</dt><dd>{label(recovery.severity)}</dd></div><div><dt>Nguồn</dt><dd>{label(recovery.source)}</dd></div></dl><p className={styles.detailText}>{recovery.summary ?? ""}</p><DetailLinks related={{ caseId: recovery.caseId }} /></> : null}</section>
    <ConsentCard detail={detail} />
  </>;
}

function CareDrawer({ open, initialCustomerId, branchId, onClose, onSaved }: { open: boolean; initialCustomerId?: string; branchId?: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"CALL" | "INTERNAL_NOTE" | "FOLLOW_UP">("CALL");
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [summary, setSummary] = useState("");
  const [outcomeCode, setOutcomeCode] = useState("CONTACTED");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | undefined>(undefined);
  const customers = useBenefitResource(open && !initialCustomerId && customerSearch.trim().length >= 2 ? `/v1/customers?search=${encodeURIComponent(customerSearch.trim())}&limit=8` : null);
  const choices = Array.isArray(customers.data) ? customers.data : Array.isArray(customers.data?.items) ? customers.data.items : [];

  useEffect(() => {
    if (open) { setCustomerId(initialCustomerId ?? ""); setError(""); key.current = crypto.randomUUID(); }
  }, [open, initialCustomerId]);
  if (!open) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerId) { setError("Hãy chọn khách hàng trước khi tạo hoạt động."); return; }
    if (!summary.trim()) { setError(kind === "FOLLOW_UP" ? "Hãy nhập lý do hoặc ghi chú follow-up." : "Hãy nhập nội dung chăm sóc."); return; }
    if (kind === "FOLLOW_UP" && !dueAt) { setError("Hãy chọn thời hạn follow-up."); return; }
    setSaving(true); setError("");
    try {
      if (kind === "FOLLOW_UP") {
        await benefitApi("/v1/customer-care/followups", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key.current ?? crypto.randomUUID() }, body: JSON.stringify({ customerId, branchId: branchId || undefined, reasonCode: summary.trim(), dueAt: new Date(dueAt).toISOString(), priority }) });
      } else {
        await benefitApi("/v1/customer-care/activities", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key.current ?? crypto.randomUUID() }, body: JSON.stringify({ customerId, branchId: branchId || undefined, activityType: kind, outcomeCode: kind === "CALL" ? outcomeCode : undefined, summary: summary.trim() }) });
      }
      onSaved(); onClose(); setSummary("");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể lưu hoạt động chăm sóc.");
    } finally { setSaving(false); }
  };
  return <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="care-drawer-title"><div className={styles.drawerHeader}><div><span className={styles.eyebrow}>CUSTOMER CARE</span><h2 id="care-drawer-title">Tạo hoạt động chăm sóc</h2></div><button className={styles.iconButton} type="button" onClick={onClose} aria-label="Đóng"><Icon name="close" /></button></div><div className={styles.drawerTabs}><button className={kind === "CALL" ? styles.tabActive : styles.tab} type="button" onClick={() => setKind("CALL")}>Cuộc gọi</button><button className={kind === "INTERNAL_NOTE" ? styles.tabActive : styles.tab} type="button" onClick={() => setKind("INTERNAL_NOTE")}>Ghi chú nội bộ</button><button className={kind === "FOLLOW_UP" ? styles.tabActive : styles.tab} type="button" onClick={() => setKind("FOLLOW_UP")}>Follow-up</button></div><form onSubmit={submit} className={styles.form}><label>Khách hàng{initialCustomerId ? <span className={styles.privacyHint}>Khách hàng hiện tại đã được chọn</span> : <><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tìm tên khách hàng…" aria-label="Tìm khách hàng" />{choices.length ? <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} aria-label="Chọn khách hàng"><option value="">Chọn khách hàng</option>{choices.map((item: any) => <option key={item.id} value={item.id}>{item.displayName ?? item.name ?? "Khách hàng được bảo vệ"}</option>)}</select> : null}</>}</label>{kind === "CALL" ? <label>Kết quả cuộc gọi<select value={outcomeCode} onChange={(event) => setOutcomeCode(event.target.value)}><option value="CONTACTED">Đã liên hệ</option><option value="NO_ANSWER">Không nghe máy</option><option value="CALL_BACK_REQUESTED">Khách hẹn gọi lại</option><option value="RESOLVED">Đã xử lý</option></select></label> : null}<label>{kind === "FOLLOW_UP" ? "Lý do follow-up" : "Nội dung"}<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} rows={5} required placeholder={kind === "INTERNAL_NOTE" ? "Ghi chú chỉ dành cho nhân viên có quyền…" : "Tóm tắt hoạt động…"} /></label>{kind === "FOLLOW_UP" ? <><label>Ngày/giờ đến hạn<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required /></label><label>Mức độ ưu tiên<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="LOW">Thấp</option><option value="MEDIUM">Trung bình</option><option value="HIGH">Cao</option></select></label></> : <p className={styles.privacyHint}>Ghi chú nội bộ chỉ hiển thị cho nhân viên có quyền.</p>}{error ? <div className={styles.formError} role="alert">{error}</div> : null}<div className={styles.drawerActions}><button className={styles.buttonQuiet} type="button" onClick={onClose}>Hủy</button><button className={styles.buttonPrimary} type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu hoạt động"}</button></div></form></section></div>;
}

export default function CustomerCareHub({ customerId }: CustomerCareHubProps) {
  const [filters, setFilters] = useState<CareFilters>(readFilters);
  const [branches, setBranches] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ sourceType: string; sourceId: string } | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(window.location.search);
    const sourceType = params.get("sourceType");
    const sourceId = params.get("sourceId");
    return sourceType && sourceId ? { sourceType, sourceId } : undefined;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const query = useMemo(() => buildQuery(filters, customerId), [filters, customerId]);
  const overviewQuery = useMemo(() => buildOverviewQuery(filters, customerId), [filters, customerId]);
  const overview = useBenefitResource(`/v1/customer-care/overview${overviewQuery ? `?${overviewQuery}` : ""}`);
  const directory = useBenefitResource(`/v1/customer-care/directory${query ? `?${query}` : ""}`);
  const followups = useBenefitResource(`/v1/customer-care/followups?page=1&pageSize=6${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}`);
  const detailPath = selected ? `/v1/customer-care/activity/${encodeURIComponent(selected.sourceType)}/${encodeURIComponent(selected.sourceId)}` : null;
  const detail = useBenefitResource(detailPath);
  const overviewReady = overview.state === "ready";
  const directoryReady = directory.state === "ready";
  const summary = overview.data?.totals ?? {};
  const items = Array.isArray(directory.data?.items) ? directory.data.items : [];
  const total = directoryReady ? Number(directory.data?.pagination?.total ?? 0) : null;
  const totalPages = directoryReady ? Number(directory.data?.pagination?.totalPages ?? 0) : 0;
  const directoryCustomer = items.find((item: any) => item.customer?.id === customerId)?.customer;
  const selectedCustomerId = detail.data?.customer?.id ?? items.find((item: any) => item.sourceType === selected?.sourceType && item.sourceId === selected?.sourceId)?.customer?.id ?? customerId;

  useEffect(() => {
    let alive = true;
    const loadBranches = async () => {
      try {
        const result = await getAuthorizedBranchContext();
        if (!alive) return;
        setBranches(result.branches);
        setFilters((old) => ({ ...old, branchId: old.branchId || result.branchId || "" }));
      } catch { /* the API resource will surface the authoritative error */ }
    };
    void loadBranches();
    const onBranchChange = () => void loadBranches();
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { alive = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selected) { params.set("sourceType", selected.sourceType); params.set("sourceId", selected.sourceId); }
    else { params.delete("sourceType"); params.delete("sourceId"); }
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, [selected]);

  const update = (key: keyof CareFilters, value: string | number) => setFilters((old) => ({ ...old, [key]: value, ...(key === "pageSize" ? { page: 1 } : {}), ...(key !== "page" && key !== "pageSize" ? { page: 1 } : {}) }));
  const clearFilters = () => setFilters({ ...defaultFilters, branchId: getActiveBranchId() ?? "" });
  const refresh = () => { void overview.load(); void directory.load(); void followups.load(); if (selected) void detail.load(); };
  const completeFollowup = async (item: any) => {
    if (item.sourceDomain !== "CUSTOMER_CARE") return;
    try {
      await benefitApi(`/v1/customer-care/followups/${encodeURIComponent(item.id)}/complete`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ version: item.version }) });
      refresh();
    } catch { /* the next resource refresh keeps the authoritative state */ }
  };

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><p className={styles.breadcrumb}><span>Khách hàng</span><b>/</b><span>{customerId ? "Lịch sử liên hệ & chăm sóc" : "Liên hệ & chăm sóc"}</span></p><h1>{customerId ? "Lịch sử liên hệ & chăm sóc" : "Lịch sử liên hệ & chăm sóc"}</h1><p className={styles.subtitle}>Theo dõi email, cuộc gọi, ghi chú và các hoạt động follow-up để chăm sóc khách hàng nhất quán.</p></div><div className={styles.headerActions}>{customerId ? <a className={styles.buttonQuiet} href={`/admin/customers/${customerId}`}>Quay lại hồ sơ</a> : <button className={styles.buttonQuiet} type="button" onClick={() => void directory.load()}><Icon name="refresh" /> Làm mới</button>}<button className={styles.buttonPrimary} type="button" onClick={() => setDrawerOpen(true)}><Icon name="plus" /> Tạo hoạt động chăm sóc</button></div></header>

    <section className={styles.kpiGrid} aria-label="Tổng quan chăm sóc"><Kpi icon="calendar" tone={styles.kpiBlue} labelText="Liên hệ hôm nay" value={overviewReady ? formatInteger(summary.activitiesToday) : "—"} helper={overviewReady ? `${formatInteger(summary.automaticActivitiesToday)} tự động · ${formatInteger(summary.manualActivitiesToday)} thủ công` : "Dữ liệu chưa sẵn sàng"} /><Kpi icon="file" tone={styles.kpiLavender} labelText="Email đã gửi" value={overviewReady ? formatInteger(summary.emailsSentInPeriod) : "—"} helper={overviewReady ? "Trong kỳ đang xem" : "Dữ liệu chưa sẵn sàng"} /><Kpi icon="check" tone={styles.kpiGreen} labelText="Tỷ lệ gửi thành công" value={overviewReady && summary.emailDeliverySuccessRate != null ? `${summary.emailDeliverySuccessRate}%` : "—"} helper={overviewReady ? `${formatInteger(summary.emailFailedInPeriod)} email lỗi` : "Không có dữ liệu"} /><Kpi icon="clock" tone={styles.kpiPurple} labelText="Follow-up đang mở" value={overviewReady ? formatInteger(summary.openFollowUpCount) : "—"} helper={overviewReady ? "Cần xử lý" : "Không có dữ liệu"} /><Kpi icon="alert" tone={styles.kpiAmber} labelText="Quá hạn" value={overviewReady ? formatInteger(summary.overdueFollowUpCount) : "—"} helper={overviewReady ? "Cần xử lý ngay" : "Không có dữ liệu"} /><Kpi icon="customer" tone={styles.kpiRose} labelText="Khách lâu chưa chăm sóc" value={overviewReady ? formatInteger(summary.customersWithoutRecentCareCount) : "—"} helper={overviewReady ? `Theo ngưỡng ${overview.data?.careInactivityDays ?? "server"} ngày` : "Không có dữ liệu"} /></section>

    {overview.state === "error" ? <div className={styles.errorBanner} role="alert"><strong>Không thể tải tổng quan chăm sóc.</strong><span>{overview.error}</span><button type="button" onClick={() => void overview.load()}>Thử lại</button></div> : null}{overview.state === "forbidden" ? <div className={styles.errorBanner} role="alert"><strong>Bạn không có quyền xem Customer Care.</strong><span>Liên hệ quản trị viên để được cấp quyền phù hợp.</span></div> : null}

    <section className={styles.channelCard}><div><span className={styles.eyebrow}>HOẠT ĐỘNG THEO KÊNH</span><h2>Kênh liên hệ thực tế</h2></div><div className={styles.channelGrid}>{(overview.data?.channels ?? []).length ? overview.data.channels.map((channel: any) => <div className={styles.channel} key={channel.channel}><div><span className={styles.channelIcon}><Icon name={channel.channel === "EMAIL" ? "file" : channel.channel === "CALL" ? "phone" : channel.channel === "INTERNAL_NOTE" ? "file" : "shield"} /></span><strong>{label(channel.channel)}</strong></div><b>{channel.percentage}%</b><div className={styles.progress}><span style={{ width: `${Math.min(Number(channel.percentage ?? 0), 100)}%` }} /></div><small>{formatInteger(channel.count)} hoạt động</small></div>) : <p className={styles.muted}>Chưa có hoạt động theo kênh trong kỳ.</p>}</div></section>

    <section className={styles.filterCard}><div className={styles.filterGrid}><label className={styles.searchField}><Icon name="search" /><span>Tìm khách hàng / email / nội dung / mã liên quan</span><input value={filters.search} onChange={(event) => update("search", event.target.value)} aria-label="Tìm hoạt động chăm sóc" /></label><label>Chi nhánh<select value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả trong phạm vi</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Loại hoạt động<select value={filters.activityType} onChange={(event) => update("activityType", event.target.value)}><option value="ALL">Tất cả</option><option value="EMAIL">Email</option><option value="CALL">Cuộc gọi</option><option value="INTERNAL_NOTE">Ghi chú nội bộ</option><option value="FOLLOW_UP">Follow-up</option><option value="SERVICE_RECOVERY">Service Recovery</option></select></label><label>Trạng thái<select value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="ALL">Tất cả</option><option value="SUCCESS">Đã ghi nhận</option><option value="PENDING">Đang chờ</option><option value="FAILED">Thất bại</option><option value="SUPPRESSED">Đã chặn</option><option value="OVERDUE">Quá hạn</option></select></label><label>Từ ngày<input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /></label><label>Đến ngày<input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></label></div><div className={styles.filterFooter}><div className={styles.chips}><button className={filters.activityType === "ALL" && filters.status === "ALL" ? styles.chipActive : styles.chip} type="button" onClick={() => { update("activityType", "ALL"); update("status", "ALL"); }}>Tất cả</button><button className={filters.activityType === "EMAIL" ? styles.chipActive : styles.chip} type="button" onClick={() => update("activityType", "EMAIL")}>Email</button><button className={filters.activityType === "CALL" ? styles.chipActive : styles.chip} type="button" onClick={() => update("activityType", "CALL")}>Cuộc gọi</button><button className={filters.activityType === "INTERNAL_NOTE" ? styles.chipActive : styles.chip} type="button" onClick={() => update("activityType", "INTERNAL_NOTE")}>Ghi chú nội bộ</button><button className={filters.status === "OVERDUE" ? styles.chipActive : styles.chip} type="button" onClick={() => update("status", "OVERDUE")}>Quá hạn</button></div><div className={styles.filterTools}><label>Sắp xếp<select value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option></select></label><button className={styles.buttonQuiet} type="button" onClick={clearFilters}>Xóa bộ lọc</button></div></div></section>

    <div className={styles.workspace}><section className={styles.tableCard}><div className={styles.tableHeader}><div><span className={styles.eyebrow}>DỮ LIỆU TỔNG HỢP TỪ MÁY CHỦ</span><h2>Hoạt động chăm sóc khách hàng</h2><span>{directoryReady ? `${formatInteger(total)} hoạt động trong phạm vi truy cập` : "Dữ liệu được tải theo trang từ máy chủ"}</span></div><span className={styles.freshness}>{overview.data?.generatedAt ? `Cập nhật ${formatDate(overview.data.generatedAt)}` : ""}</span></div>{directory.state === "loading" ? <div className={styles.panelState}>Đang tải hoạt động chăm sóc…</div> : null}{directory.state === "error" ? <div className={styles.errorBanner} role="alert"><strong>Không thể tải danh sách.</strong><span>{directory.error}</span><button type="button" onClick={() => void directory.load()}>Thử lại</button></div> : null}{directory.state === "forbidden" ? <div className={styles.panelState}>Bạn không có quyền xem danh sách Customer Care.</div> : null}{directoryReady && !items.length ? <div className={styles.emptyState}><Icon name="activity" /><strong>Chưa có hoạt động chăm sóc phù hợp</strong><span>Thử xóa bộ lọc hoặc tạo hoạt động mới.</span><button className={styles.buttonQuiet} type="button" onClick={clearFilters}>Xóa bộ lọc</button></div> : null}{directoryReady && items.length ? <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Hoạt động chăm sóc khách hàng</caption><thead><tr><th scope="col">Thời gian</th><th scope="col">Khách hàng</th><th scope="col">Kênh</th><th scope="col">Nội dung</th><th scope="col">Liên quan</th><th scope="col">Người thực hiện</th><th scope="col">Kết quả</th><th scope="col">Follow-up</th><th scope="col">Thao tác</th></tr></thead><tbody>{items.map((item: any) => <tr key={`${item.sourceType}-${item.sourceId}`} aria-selected={selected?.sourceId === item.sourceId && selected?.sourceType === item.sourceType} className={selected?.sourceId === item.sourceId && selected?.sourceType === item.sourceType ? styles.selectedRow : ""}><td>{formatDate(item.occurredAt)}</td><td><button className={styles.customerButton} type="button" onClick={() => setSelected({ sourceType: item.sourceType, sourceId: item.sourceId })}><span className={styles.miniAvatar}>{initials(item.customer?.displayName)}</span><span><strong>{item.customer?.displayName ?? "Khách hàng giới hạn"}</strong><small>{item.customer?.phoneMasked ?? "Thông tin liên hệ được giới hạn"}</small></span></button></td><td><span className={styles.channelLabel}><Icon name={item.channel === "EMAIL" ? "file" : item.channel === "CALL" ? "phone" : item.channel === "INTERNAL_NOTE" ? "file" : "shield"} />{label(item.channel)}</span></td><td><strong>{item.title}</strong><small>{item.summary}</small></td><td>{item.related ? <span className={styles.related}>{label(item.related.type)}<small>{item.related.reference ?? "Mã liên quan được bảo vệ"}</small></span> : "—"}</td><td>{item.actor?.displayName ?? "—"}</td><td><span className={`${styles.badge} ${statusTone(item.result?.displayStatus)}`}>{label(item.result?.displayStatus)}</span>{item.result?.safeErrorCode ? <small className={styles.errorText}>{item.result.safeErrorCode}</small> : null}</td><td>{item.followUp?.required ? <span className={`${styles.badge} ${statusTone(item.followUp.derivedStatus)}`}>{label(item.followUp.derivedStatus)}</span> : <span className={styles.muted}>Không cần</span>}</td><td><button className={styles.rowAction} type="button" onClick={() => setSelected({ sourceType: item.sourceType, sourceId: item.sourceId })}>Xem chi tiết<Icon name="arrowRight" /></button></td></tr>)}</tbody></table></div> : null}{directoryReady && total ? <div className={styles.pagination}><span>Hiển thị {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, total)} trong {total}</span><div><button type="button" disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)} aria-label="Trang trước">‹</button><b>{filters.page} / {Math.max(totalPages, 1)}</b><button type="button" disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)} aria-label="Trang sau">›</button><select value={filters.pageSize} onChange={(event) => update("pageSize", Number(event.target.value))} aria-label="Số dòng mỗi trang"><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div> : null}</section><aside className={styles.rail} aria-label="Chi tiết chăm sóc"><ActivityDetail detail={detail.data} loading={detail.state === "loading"} /></aside></div>

    <section className={styles.lowerGrid}><section className={styles.tableCard}><div className={styles.tableHeader}><div><span className={styles.eyebrow}>BẢNG FOLLOW-UP</span><h2>Follow-up cần xử lý</h2></div><span className={styles.freshness}>{followups.data?.pagination?.total != null ? `${formatInteger(followups.data.pagination.total)} mục` : ""}</span></div>{followups.state === "error" ? <div className={styles.panelState}>Không thể tải follow-up: {followups.error}</div> : followups.state === "loading" ? <div className={styles.panelState}>Đang tải follow-up…</div> : <div className={styles.followupList}>{(followups.data?.items ?? []).length ? followups.data.items.map((item: any) => <div className={styles.followupRow} key={`${item.sourceDomain}-${item.id}`}><span className={`${styles.priority} ${styles[`priority_${item.priority}`]}`}>{label(item.priority)}</span><div><strong>{item.customer?.displayName ?? "Khách hàng giới hạn"}</strong><small>{item.reason}</small></div><div><span>{formatDate(item.dueAt)}</span><small className={statusTone(item.derivedStatus)}>{label(item.derivedStatus)}</small></div>{item.sourceDomain === "CUSTOMER_CARE" ? <button className={styles.rowAction} type="button" onClick={() => void completeFollowup(item)}>{item.derivedStatus === "OVERDUE" ? "Hoàn tất" : "Đánh dấu xong"}</button> : <a className={styles.rowAction} href={item.related?.id ? `/admin/service-recovery/${item.related.id}` : "/admin/service-recovery"}>Mở Recovery<Icon name="arrowRight" /></a>}</div>) : <div className={styles.emptyState}><strong>Chưa có follow-up cần xử lý</strong><span>Dữ liệu được lấy từ Customer Care và Service Recovery.</span></div>}</div>}</section><section className={styles.tableCard}><div className={styles.cardTitle}><Icon name="shield" /><h2>An toàn liên hệ</h2></div><div className={styles.safetyList}><div><Icon name="file" /><span>Email chỉ hiển thị trạng thái đã được lưu từ Communication Engine.</span></div><div><Icon name="check" /><span>Marketing được kiểm tra consent và suppression trước khi gửi.</span></div><div><Icon name="lock" /><span>Ghi chú nội bộ chỉ dành cho nhân viên có quyền.</span></div><div><Icon name="activity" /><span>Không suy đoán hành vi mở email khi provider chưa có sự kiện xác nhận.</span></div></div></section></section>

    <CareDrawer open={drawerOpen} initialCustomerId={customerId ?? selectedCustomerId ?? directoryCustomer?.id} branchId={filters.branchId || getActiveBranchId() || ""} onClose={() => setDrawerOpen(false)} onSaved={refresh} />
  </main>;
}

