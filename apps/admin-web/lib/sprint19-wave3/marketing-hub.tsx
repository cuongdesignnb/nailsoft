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
  formatMoney,
  rows,
  useBenefitResource,
} from "./benefit-shared";
import styles from "./marketing-hub.module.css";

type CampaignFilters = {
  search: string;
  branchId: string;
  status: string;
  campaignType: string;
  riskLevel: string;
  segmentId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  sort: string;
};

const defaultFilters: CampaignFilters = {
  search: "",
  branchId: "",
  status: "",
  campaignType: "",
  riskLevel: "",
  segmentId: "",
  from: "",
  to: "",
  page: 1,
  pageSize: 10,
  sort: "NEWEST",
};

const statusLabels: Record<string, string> = {
  DRAFT: "Bản nháp",
  PENDING_APPROVAL: "Chờ phê duyệt",
  APPROVED: "Đã duyệt",
  SCHEDULED: "Đã lên lịch",
  RUNNING: "Đang chạy",
  PAUSED: "Đã tạm dừng",
  COMPLETED: "Đã hoàn tất",
  CANCELLED: "Đã hủy",
  FAILED: "Thất bại",
};

const campaignTypeLabels: Record<string, string> = {
  PROMOTION: "Khuyến mãi",
  NEWSLETTER: "Bản tin",
  NEW_SERVICE: "Dịch vụ mới",
  SEASONAL_CAMPAIGN: "Chiến dịch theo mùa",
  MEMBERSHIP_OFFER: "Ưu đãi Membership",
  LOYALTY_OFFER: "Ưu đãi Loyalty",
};

const riskLabels: Record<string, string> = {
  STANDARD: "Tiêu chuẩn",
  ELEVATED: "Cần kiểm soát",
  HIGH: "Rủi ro cao",
};

function readFilters(): CampaignFilters {
  if (typeof window === "undefined") return defaultFilters;
  const params = new URLSearchParams(window.location.search);
  const value = { ...defaultFilters };
  for (const key of Object.keys(value) as Array<keyof CampaignFilters>) {
    const raw = params.get(key);
    if (raw == null) continue;
    if (["page", "pageSize"].includes(key)) {
      (value[key] as number) = Number(raw) || Number(value[key]);
    } else {
      (value[key] as string) = raw;
    }
  }
  if (!value.branchId) value.branchId = getActiveBranchId() ?? "";
  return value;
}

function queryFor(filters: CampaignFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "") continue;
    if (key === "page" && value === 1) continue;
    if (key === "pageSize" && value === 10) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function overviewQueryFor(filters: CampaignFilters) {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

function statusLabel(value: unknown) {
  const key = String(value ?? "");
  return statusLabels[key] ?? key.replaceAll("_", " ");
}

function typeLabel(value: unknown) {
  const key = String(value ?? "");
  return campaignTypeLabels[key] ?? key.replaceAll("_", " ");
}

function initials(value: unknown) {
  const words = String(value ?? "?").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1
    ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
    : words[0]?.slice(0, 2) ?? "?").toUpperCase();
}

function count(value: unknown) {
  return formatInteger(Number(value ?? 0));
}

function moneyByCurrency(value: any, field: string) {
  const groups = Array.isArray(value) ? value : [];
  if (!groups.length) return "—";
  return groups
    .map((group) => formatMoney(group?.[field] ?? 0, group?.currency ?? "VND"))
    .join(" · ");
}

function evidenceMoney(value: unknown, currency: unknown) {
  return value == null ? "—" : formatMoney(Number(value), String(currency ?? "VND"));
}

function shortId(value: unknown) {
  const id = String(value ?? "");
  return id ? `#${id.slice(0, 8)}` : "—";
}

function evidenceStatusLabel(value: unknown) {
  const labels: Record<string, string> = {
    CAPTURED: "Đã thu",
    PAID: "Đã thanh toán",
    ISSUED: "Đã phát hành",
    PENDING: "Đang chờ",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
  };
  const key = String(value ?? "");
  return labels[key] ?? (key ? key.replaceAll("_", " ") : "—");
}

function useMarketingMutation() {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState<string | undefined>();
  const intentKeys = useRef<Record<string, string>>({});
  async function submit(path: string, body: unknown, intent: string) {
    setState("submitting");
    setMessage("");
    setCode(undefined);
    const key = intentKeys.current[intent] ?? crypto.randomUUID();
    intentKeys.current[intent] = key;
    try {
      const value = await benefitApi(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
      delete intentKeys.current[intent];
      setState("success");
      setMessage("Đã cập nhật trạng thái chiến dịch.");
      return value;
    } catch (cause: any) {
      setState("error");
      setCode(cause?.code);
      setMessage(cause?.message ?? "Không thể hoàn tất thao tác. Dữ liệu chưa được cập nhật cục bộ.");
      return undefined;
    }
  }
  return { state, message, code, submit };
}

function StateMessage({ resource, label, empty }: { resource: ReturnType<typeof useBenefitResource>; label: string; empty?: string }) {
  if (resource.state === "loading") return <div className={styles.loading} role="status">Đang tải {label}…</div>;
  if (resource.state === "forbidden") return <div className={styles.error} role="alert">Bạn không có quyền xem {label}.</div>;
  if (resource.state === "offline") return <div className={styles.error} role="alert">Đang ngoại tuyến. Dữ liệu Marketing có thể chưa phải mới nhất.<button type="button" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "error") return <div className={styles.error} role="alert">Không thể tải {label}: {resource.error}<button type="button" onClick={() => void resource.load()}>Thử lại</button></div>;
  if (resource.state === "empty") return <div className={styles.empty} role="status"><strong>{empty ?? `Chưa có ${label}.`}</strong></div>;
  return null;
}

function Kpi({ icon, tone, label, value, helper }: { icon: string; tone: string; label: string; value: string; helper: string }) {
  return <article className={`${styles.kpi} ${styles[tone]}`}><span className={styles.kpiIcon}><Icon name={icon as any} /></span><div className={styles.kpiText}><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></article>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`${styles.badge} ${styles[`badge_${value}`] ?? ""}`}>{statusLabel(value)}</span>;
}

function AudienceBar({ audience }: { audience: any }) {
  const total = Math.max(1, Number(audience?.snapshotCount ?? 0));
  const sent = Number(audience?.sentCount ?? 0);
  const suppressed = Number(audience?.suppressedCount ?? 0);
  const failed = Number(audience?.failedCount ?? 0);
  const pending = Math.max(0, total - sent - suppressed - failed - Number(audience?.cancelledCount ?? 0));
  return <div className={styles.audienceCell}><div className={styles.audienceBar} role="img" aria-label={`Audience ${count(total)}`}><span style={{ flex: Math.max(0, sent) }} /><span style={{ flex: Math.max(0, suppressed) }} /><span style={{ flex: Math.max(0, failed) }} /><span style={{ flex: Math.max(0, pending) }} /></div><small>{count(total)} snapshot · {count(sent)} gửi</small></div>;
}

function filterSummary(filters: any) {
  if (!filters || typeof filters !== "object") return "Bộ lọc do server quản lý";
  const facts: string[] = [];
  if (filters.marketingConsent === true) facts.push("Marketing consent bắt buộc");
  if (filters.contactable === true) facts.push("Email có thể liên hệ");
  if (filters.locale) facts.push(`Locale: ${filters.locale}`);
  if (filters.branchVisited) facts.push("Đã ghé chi nhánh");
  if (filters.tagId) facts.push("Có Customer Tag");
  return facts.length ? facts.join(" · ") : "Không có bộ lọc hiển thị thêm";
}

function CampaignCreateDrawer({ open, onClose, onSaved, branches, segments, templates, context, mutation, allowTenantWide = Boolean(context?.tenantWideAllowed) }: { open: boolean; onClose: () => void; onSaved: () => void; branches: any[]; segments: any[]; templates: any[]; context: any; mutation: ReturnType<typeof useMarketingMutation>; allowTenantWide?: boolean }) {
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [campaignType, setCampaignType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setName("");
    setBranchId((current) => current || (allowTenantWide ? "" : String(branches[0]?.id ?? "")));
    setSegmentId((current) => current || String(segments[0]?.id ?? ""));
    setTemplateVersionId((current) => current || String(templates[0]?.templateVersionId ?? ""));
    setCampaignType((current) => current || String(context?.campaignTypes?.[0] ?? ""));
    setRiskLevel((current) => current || String(context?.riskLevels?.[0] ?? ""));
  }, [open, context, segments, templates, branches, allowTenantWide]);

  if (!open) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !segmentId || !templateVersionId || !campaignType || !riskLevel) {
      setError("Hãy chọn đủ nhóm khách, mẫu Email, loại và mức rủi ro.");
      return;
    }
    const result = await mutation.submit("/v1/marketing-campaigns", { name: name.trim(), branchId: branchId || null, segmentId, templateVersionId, campaignType, riskLevel }, "campaign-create");
    if (result) {
      onSaved();
      onClose();
    }
  };
  return <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="marketing-create-title"><div className={styles.drawerHead}><div><span className={styles.eyebrow}>EMAIL MARKETING · DRAFT</span><h2 id="marketing-create-title">Tạo chiến dịch</h2></div><button className={styles.iconButton} type="button" onClick={onClose} aria-label="Đóng"><Icon name="close" /></button></div><div className={styles.drawerSteps}><span className={`${styles.drawerStep} ${styles.drawerStepActive}`}>1. Thông tin</span><span className={styles.drawerStep}>2. Nhóm khách</span><span className={styles.drawerStep}>3. Mẫu Email</span><span className={styles.drawerStep}>4. Tạo bản nháp</span></div><form className={styles.form} onSubmit={submit}><label>Tên chiến dịch<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nhập tên chiến dịch" required /></label><label>Chi nhánh<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{allowTenantWide ? <option value="">Toàn salon</option> : null}{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Nhóm khách hàng<select value={segmentId} onChange={(event) => setSegmentId(event.target.value)} required><option value="">Chọn nhóm khách hàng</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label><label>Mẫu Email Marketing<select value={templateVersionId} onChange={(event) => setTemplateVersionId(event.target.value)} required><option value="">Chọn mẫu Email đang hoạt động</option>{templates.map((template) => <option key={template.templateVersionId} value={template.templateVersionId}>{template.code} · {template.locale} · v{template.versionNumber}</option>)}</select></label>{templates.find((template) => template.templateVersionId === templateVersionId) ? <div className={styles.templatePreview}><strong>{templates.find((template) => template.templateVersionId === templateVersionId)?.subject}</strong><small>{templates.find((template) => template.templateVersionId === templateVersionId)?.plainTextBody?.slice(0, 220)}</small></div> : null}<label>Loại chiến dịch<select value={campaignType} onChange={(event) => setCampaignType(event.target.value)} required>{(context?.campaignTypes ?? []).map((type: string) => <option key={type} value={type}>{campaignTypeLabels[type] ?? type}</option>)}</select></label><label>Mức rủi ro<select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} required>{(context?.riskLevels ?? []).map((level: string) => <option key={level} value={level}>{riskLabels[level] ?? level}</option>)}</select></label><div className={styles.formHint}>Marketing consent luôn bắt buộc. Audience được kiểm tra lại consent, Email status, suppression, giới hạn tần suất và quiet hours ngay trước khi gửi. Bước này chỉ tạo bản nháp, chưa gửi Email.</div>{context?.settings?.audienceLimit ? <small className={styles.formHint}>Giới hạn Audience hiện tại: {count(context.settings.audienceLimit)} bản ghi.</small> : null}{mutation.message && mutation.state === "error" ? <div className={styles.formError}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div> : null}{error ? <div className={styles.formError}>{error}</div> : null}<div className={styles.drawerActions}><button className={styles.quiet} type="button" onClick={onClose}>Hủy</button><button className={styles.primary} type="submit" disabled={mutation.state === "submitting" || segments.length === 0 || templates.length === 0}>{mutation.state === "submitting" ? "Đang tạo…" : "Tạo bản nháp"}</button></div></form></section></div>;
}

function CampaignInspector({ detail, preview, onAction, canApprove, canSchedule, canCancel, canCreate, canReport, mutation }: { detail: any; preview: any; onAction: (action: string, scheduledAt?: string) => void; canApprove: boolean; canSchedule: boolean; canCancel: boolean; canCreate: boolean; canReport: boolean; mutation: ReturnType<typeof useMarketingMutation> }) {
  const [scheduledAt, setScheduledAt] = useState("");
  if (!detail) return <section className={styles.railCard}><div className={styles.empty}><Icon name="trend" /><strong>Chọn một chiến dịch</strong><span>Chi tiết Audience, quyền gửi và trạng thái Email sẽ hiển thị tại đây.</span></div></section>;
  const campaign = detail.campaign ?? {};
  const status = String(campaign.status ?? "");
  const audience = detail.audience ?? {};
  const messages = detail.messages ?? {};
  const consent = detail.consentSafety ?? {};
  const actionsByState = status === "DRAFT" ? ["preview", "submit", "cancel"] : status === "PENDING_APPROVAL" ? ["preview", "approve", "cancel"] : status === "APPROVED" ? ["schedule", "cancel"] : status === "SCHEDULED" ? ["view_schedule", "cancel"] : status === "RUNNING" ? ["pause"] : status === "PAUSED" ? ["resume", "cancel"] : status === "COMPLETED" ? [canReport ? "report" : "history"] : status === "FAILED" ? ["failure"] : ["history"];
  const actions = actionsByState.filter((action) => action === "preview" || action === "view_schedule" || action === "report" || action === "history" || action === "failure" || (action === "submit" && canCreate) || (action === "approve" && canApprove) || ((action === "schedule" || action === "pause" || action === "resume") && canSchedule) || (action === "cancel" && canCancel));
  const labelForAction: Record<string, string> = { preview: "Xem trước Audience", submit: "Gửi duyệt", approve: "Phê duyệt", schedule: "Lên lịch gửi", view_schedule: "Xem lịch gửi", pause: "Tạm dừng", resume: "Tiếp tục", cancel: "Hủy chiến dịch", report: "Xem báo cáo", failure: "Xem lỗi", history: "Xem lịch sử" };
  const attribution = detail.attribution ?? {};
  return <><section className={styles.railCard}><div className={styles.railHead}><div><span className={styles.eyebrow}>CHIẾN DỊCH ĐANG CHỌN</span><h2>{campaign.name ?? "Chiến dịch"}</h2></div><StatusBadge value={status} /></div><div className={styles.owner}><span className={styles.avatar}>{initials(detail.owner?.displayName ?? campaign.name)}</span><div><strong>{detail.owner?.displayName ?? "Người tạo được giới hạn"}</strong><small>{typeLabel(campaign.campaignType)} · {riskLabels[campaign.riskLevel] ?? campaign.riskLevel}</small></div><a href={`/admin/marketing/campaigns/${campaign.id}`}>Mở chi tiết</a></div><dl className={styles.detailList}><div><dt>Chi nhánh</dt><dd>{detail.branch?.name ?? "Toàn salon"}</dd></div><div><dt>Nhóm khách hàng</dt><dd>{detail.segment?.name ?? "—"}</dd></div><div><dt>Phiên bản nhóm</dt><dd>{detail.segment?.version ?? "—"}</dd></div><div><dt>Người duyệt</dt><dd>{detail.approver?.displayName ?? "Chưa duyệt"}</dd></div><div><dt>Lịch gửi</dt><dd>{formatDate(campaign.scheduledAt)}</dd></div><div><dt>Bắt đầu</dt><dd>{formatDate(campaign.startedAt)}</dd></div></dl></section><section className={styles.railCard}><h2>Đối tượng chiến dịch</h2><dl className={styles.detailList}><div className={styles.emphasis}><dt>Audience đã snapshot</dt><dd>{count(audience.snapshotCount)}</dd></div><div><dt>Đã gửi</dt><dd>{count(messages.sent)}</dd></div><div><dt>Đã bị chặn</dt><dd>{count(messages.suppressed)}</dd></div><div><dt>Thất bại</dt><dd>{count(messages.failed + messages.deadLetter)}</dd></div><div><dt>Đang chờ</dt><dd>{count(messages.pending + messages.scheduled + messages.processing)}</dd></div></dl><div className={styles.safeNotice}>Audience snapshot là bằng chứng tại thời điểm phê duyệt. Consent và suppression vẫn được kiểm tra lại ngay trước khi provider gửi.</div></section>{detail.capabilities?.bookingAttribution && detail.attribution ? <section className={styles.railCard}><h2>Booking & doanh thu được ghi nhận</h2><dl className={styles.detailList}><div><dt>Booking được gán explicit</dt><dd>{count(attribution.attributedBookings)}</dd></div><div><dt>Booking đã hoàn tất</dt><dd>{count(attribution.completedAttributedBookings)}</dd></div><div><dt>Đơn đã thanh toán</dt><dd>{count(attribution.attributedPaidOrders)}</dd></div><div><dt>Doanh thu thuần theo tiền tệ</dt><dd>{moneyByCurrency(attribution.byCurrency, "netRevenueMinor")}</dd></div></dl><p className={styles.formHint}>Mô hình {attribution.model ?? "EXPLICIT_LAST_TOUCH"}; cửa sổ {count(attribution.attributionWindowDays ?? 30)} ngày. Refund đã điều chỉnh và evidence POS/Invoice hợp lệ mới được tính.</p>{Array.isArray(attribution.evidence) && attribution.evidence.length ? <div className={styles.tableScroll}><table aria-label="Bằng chứng Booking và doanh thu"><thead><tr><th scope="col">Customer</th><th scope="col">Booking</th><th scope="col">Nguồn</th><th scope="col">Thanh toán</th><th scope="col">Gross</th><th scope="col">Refund</th><th scope="col">Net</th></tr></thead><tbody>{attribution.evidence.map((row: any) => <tr key={row.attributionId}><td title={row.customerId}>{shortId(row.customerId)}</td><td><strong>{row.bookingReference ?? shortId(row.appointmentId)}</strong><small>{row.branchName ?? "—"}</small></td><td><span>{row.orderNumber ?? row.invoiceNumber ?? "Booking"}</span><small>{row.attributionSource ?? "—"}</small></td><td><span>{evidenceStatusLabel(row.paymentStatus)}</span><small>{evidenceStatusLabel(row.invoiceStatus)}</small></td><td>{evidenceMoney(row.grossRevenueMinor, row.currency)}</td><td>{evidenceMoney(row.refundMinor, row.currency)}</td><td><strong>{evidenceMoney(row.netRevenueMinor, row.currency)}</strong></td></tr>)}</tbody></table></div> : <p className={styles.formHint}>Chưa có financial evidence từ POS/Invoice hợp lệ.</p>}</section> : null}<section className={styles.railCard}><h2>Kiểm tra quyền gửi</h2><dl className={styles.consentList}><div><dt>Consent trong snapshot</dt><dd>{consent.snapshotConsentVerified ? "Đã kiểm tra" : "Chưa có dữ liệu"}</dd></div><div><dt>Bị chặn do Consent</dt><dd>{count(consent.suppressedForConsent)}</dd></div><div><dt>Bị chặn do Email</dt><dd>{count(consent.suppressedForInvalidEmail)}</dd></div><div><dt>Bị chặn do Suppression</dt><dd>{count(consent.suppressedForSuppression)}</dd></div><div><dt>Giới hạn tần suất</dt><dd>{count(consent.suppressedForFrequency)}</dd></div></dl></section><section className={styles.railCard}><h2>Nội dung Email</h2>{detail.template ? <div className={styles.detailPreview}><strong>{detail.template.subject ?? "Không có tiêu đề"}</strong><span>{detail.template.textPreview ?? "Nội dung mẫu chỉ hiển thị khi API cung cấp bản xem trước an toàn."}</span><small>{detail.template.code ?? "Mẫu Marketing"} · {detail.template.locale ?? "—"}</small></div> : <p className={styles.formHint}>Không có quyền hoặc chưa có dữ liệu mẫu Email.</p>}</section><section className={styles.railCard}><h2>Thao tác</h2>{status === "PENDING_APPROVAL" ? <p className={styles.formHint}>Người tạo không thể tự phê duyệt chiến dịch này. Backend vẫn là nơi quyết định quyền dual-control.</p> : null}{actions.includes("schedule") ? <label className={styles.form}><span>Thời điểm gửi</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required /></label> : null}<div className={styles.miniList}>{actions.map((action) => { const disabled = mutation.state === "submitting" || (action === "approve" && !canApprove) || (action === "schedule" && !canSchedule) || ((action === "pause" || action === "resume") && !canSchedule) || (action === "submit" && !canCreate) || (action === "cancel" && !canCancel); const isLink = ["report", "history", "failure"].includes(action); return isLink ? <a className={styles.railAction} key={action} href={`/admin/marketing/campaigns/${campaign.id}`}>{labelForAction[action]}</a> : <button className={`${styles.railAction} ${action === "cancel" ? styles.error : ""}`} type="button" key={action} disabled={disabled} onClick={() => action === "view_schedule" ? undefined : onAction(action, scheduledAt)}>{labelForAction[action]}{action === "view_schedule" ? ` · ${formatDate(campaign.scheduledAt)}` : ""}</button>; })}</div>{status === "SCHEDULED" ? <p className={styles.formHint}>Campaign sẽ chuyển sang Đang chạy khi Worker thấy thời điểm lịch gửi. Không thể tạm dừng trước khi chạy.</p> : null}</section>{preview ? <section className={styles.railCard}><h2>Kết quả xem trước</h2><dl className={styles.detailList}><div><dt>Customer phù hợp</dt><dd>{count(preview.count)}</dd></div><div><dt>Kênh</dt><dd>{preview.channel ?? "EMAIL"}</dd></div><div><dt>Dual-control</dt><dd>{preview.dualControlRequired ? "Bắt buộc" : "Tiêu chuẩn"}</dd></div></dl><p className={styles.formHint}>Mẫu Audience hiển thị dạng redacted theo chính sách bảo mật.</p></section> : null}</>;
}

export default function MarketingHub({ initialCampaignId }: { initialCampaignId?: string } = {}) {
  const [filters, setFilters] = useState<CampaignFilters>(readFilters);
  const [searchInput, setSearchInput] = useState(filters.search);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => initialCampaignId ?? (typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("campaignId") ?? undefined));
  const [branches, setBranches] = useState<any[]>([]);
  const [authContext, setAuthContext] = useState<any>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preview, setPreview] = useState<any>();
  const [pageNotice, setPageNotice] = useState("");
  const mutation = useMarketingMutation();
  const directoryQuery = useMemo(() => queryFor(filters), [filters]);
  const overviewQuery = useMemo(() => overviewQueryFor(filters), [filters]);
  const directory = useBenefitResource(`/v1/marketing-campaigns/directory${directoryQuery ? `?${directoryQuery}` : ""}`);
  const overview = useBenefitResource(`/v1/marketing/overview${overviewQuery ? `?${overviewQuery}` : ""}`);
  const selected = useBenefitResource(selectedId ? `/v1/marketing-campaigns/${encodeURIComponent(selectedId)}/overview` : null);
  const canReadSegments = Boolean(authContext?.authorization?.permissions?.includes("marketing.segment.read"));
  const canCreate = Boolean(authContext?.authorization?.permissions?.includes("marketing.campaign.create"));
  const canTemplateRead = Boolean(authContext?.authorization?.permissions?.includes("communication.template.read"));
  const canApprove = Boolean(authContext?.authorization?.permissions?.includes("marketing.campaign.approve"));
  const canSchedule = Boolean(authContext?.authorization?.permissions?.includes("marketing.campaign.schedule"));
  const canCancel = Boolean(authContext?.authorization?.permissions?.includes("marketing.campaign.cancel"));
  const createContext = useBenefitResource(canCreate ? "/v1/marketing-campaigns/create-context" : null);
  const segments = useBenefitResource(canReadSegments ? "/v1/customer-segments" : null);
  const templates = useBenefitResource(canTemplateRead ? "/v1/communications/templates/marketing-versions" : null);
  const data = directory.data ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const summary = data.summary ?? {};
  const overviewData = overview.data ?? {};
  const ready = directory.state === "ready";
  const total = Number(data.pagination?.total ?? 0);
  const totalPages = Number(data.pagination?.totalPages ?? 0);
  const segmentItems = rows(segments.data).filter((item) => item.status === "ACTIVE").slice(0, 5);
  const templateItems = rows(templates.data);
  const pageTitle = initialCampaignId ? String(selected.data?.campaign?.name ?? "Chi tiết Marketing") : "Marketing khách hàng";

  useEffect(() => {
    let alive = true;
    void getAuthorizedBranchContext().then(({ context, branches: allowedBranches }) => { if (alive) { setAuthContext(context); setBranches(allowedBranches); } }).catch(() => undefined);
    const onBranchChange = () => setFilters((old) => ({ ...old, branchId: getActiveBranchId() ?? "", page: 1 }));
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange);
    return () => { alive = false; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, onBranchChange); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((old) => old.search === searchInput ? old : { ...old, search: searchInput, page: 1 }), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!selectedId && ready && items[0]?.id) setSelectedId(String(items[0].id));
  }, [items, ready, selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(directoryQuery);
    if (selectedId) next.set("campaignId", selectedId); else next.delete("campaignId");
    window.history.replaceState(null, "", `${window.location.pathname}${next.toString() ? `?${next}` : ""}`);
  }, [directoryQuery, selectedId]);

  useEffect(() => {
    setPreview(undefined);
  }, [selectedId]);

  function update(key: keyof CampaignFilters, value: string | number) {
    setFilters((old) => ({ ...old, [key]: value, ...(key === "page" ? {} : { page: 1 }) }));
  }

  function clearFilters() {
    const branchId = getActiveBranchId() ?? "";
    setSearchInput("");
    setFilters({ ...defaultFilters, branchId });
  }

  async function reload() {
    await Promise.all([directory.load(), overview.load(), selectedId ? selected.load() : Promise.resolve()]);
  }

  async function previewCampaign() {
    if (!selectedId) return;
    try {
      const result = await benefitApi(`/v1/marketing-campaigns/${encodeURIComponent(selectedId)}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setPreview(result);
      setPageNotice("Audience preview được tính bởi server; mẫu Customer đã được redacted.");
    } catch (cause: any) {
      setPageNotice(cause?.message ?? "Không thể xem trước Audience.");
    }
  }

  async function action(actionName: string, scheduledAt?: string) {
    if (!selectedId || actionName === "view_schedule") return;
    if (actionName === "preview") { await previewCampaign(); return; }
    if (["report", "history", "failure"].includes(actionName)) return;
    if (actionName === "schedule" && !scheduledAt) { setPageNotice("Hãy chọn thời điểm gửi rõ ràng trước khi lên lịch."); return; }
    const body: Record<string, unknown> = { version: selected.data?.campaign?.version };
    if (actionName === "schedule") body.scheduledAt = new Date(scheduledAt as string).toISOString();
    const result = await mutation.submit(`/v1/marketing-campaigns/${encodeURIComponent(selectedId)}/${actionName}`, body, `campaign:${selectedId}:${actionName}`);
    if (result) { setPageNotice("Thao tác đã được server ghi nhận. Đang tải lại dữ liệu mới nhất…"); await reload(); }
  }

  return <main className={styles.page}><header className={styles.header}><div><p className={styles.breadcrumb}><span>Khách hàng</span><b>/</b> Marketing khách hàng</p><h1>{pageTitle}</h1><p className={styles.subtitle}>Quản lý Campaign Email, Audience snapshot và an toàn consent trong cùng một quy trình có phê duyệt.</p></div><div className={styles.headerActions}><a className={styles.quiet} href="/admin/marketing/segments"><Icon name="customer" /> Quản lý nhóm khách</a>{canCreate ? <button className={styles.primary} type="button" onClick={() => setDrawerOpen(true)}><Icon name="plus" /> Tạo chiến dịch</button> : null}</div></header>{pageNotice || mutation.message ? <div className={styles.headerNotice} role={mutation.state === "error" ? "alert" : "status"}>{pageNotice || mutation.message}</div> : null}<section className={styles.kpis} aria-label="Tổng quan Marketing"><Kpi icon="trend" tone="pink" label="Chiến dịch đang chạy" value={overview.state === "ready" ? count(overviewData.campaigns?.running) : "—"} helper="Theo trạng thái server" /><Kpi icon="calendar" tone="blue" label="Đã lên lịch" value={overview.state === "ready" ? count(overviewData.campaigns?.scheduled) : "—"} helper="Worker sẽ tự bắt đầu" /><Kpi icon="customer" tone="lavender" label="Audience đã snapshot" value={overview.state === "ready" ? count(overviewData.audience?.snapshotCount) : "—"} helper="Bằng chứng tại thời điểm duyệt" /><Kpi icon="activity" tone="green" label="Email đã gửi" value={overview.state === "ready" ? count(overviewData.delivery?.sent) : "—"} helper="Trong khoảng thời gian đã chọn" /><Kpi icon="shield" tone="amber" label="Email bị chặn" value={overview.state === "ready" ? count(overviewData.delivery?.suppressed) : "—"} helper="Consent / suppression / cap" /><Kpi icon="alert" tone="coral" label="Email thất bại" value={overview.state === "ready" ? count(Number(overviewData.delivery?.failed ?? 0) + Number(overviewData.delivery?.deadLetter ?? 0)) : "—"} helper="Không bao gồm Email bị chặn" /></section><section className={styles.hero}><div className={styles.sectionHead}><div><h2>Hiệu quả gửi Email</h2><p>Funnel chỉ sử dụng trạng thái Audience và Communication đã ghi nhận.</p></div><span className={styles.capability}>EMAIL ONLY</span></div><div className={styles.funnel}><div className={styles.funnelStep}><span>Audience snapshot</span><strong>{overview.state === "ready" ? count(overviewData.audience?.snapshotCount) : "—"}</strong><small>Đã lưu khi phê duyệt</small></div><div className={styles.funnelStep}><span>Đủ điều kiện / chờ gửi</span><strong>{overview.state === "ready" ? count(Number(overviewData.audience?.eligibleCount ?? 0) + Number(overviewData.delivery?.pending ?? 0)) : "—"}</strong><small>Preflight còn có thể thay đổi</small></div><div className={styles.funnelStep}><span>Đã gửi</span><strong>{overview.state === "ready" ? count(overviewData.delivery?.sent) : "—"}</strong><small>Provider status SENT</small></div><div className={styles.funnelStep}><span>Đã bị chặn</span><strong>{overview.state === "ready" ? count(overviewData.delivery?.suppressed) : "—"}</strong><small>Không phải lỗi provider</small></div><div className={styles.funnelStep}><span>Thất bại / hủy</span><strong>{overview.state === "ready" ? count(Number(overviewData.delivery?.failed ?? 0) + Number(overviewData.delivery?.deadLetter ?? 0) + Number(overviewData.delivery?.cancelled ?? 0)) : "—"}</strong><small>Trạng thái thực tế</small></div></div><p className={styles.funnelNote}>Open tracking, Click, Booking attribution và Revenue attribution chưa được hỗ trợ bởi source hiện tại nên không hiển thị số liệu suy diễn.</p></section><section className={styles.filterCard}><div className={styles.filterGrid}><label className={styles.search}><Icon name="search" /><span className={styles.srOnly}>Tìm chiến dịch / nhóm khách</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm chiến dịch / nhóm khách…" aria-label="Tìm chiến dịch hoặc nhóm khách" /></label><label>Chi nhánh<select value={filters.branchId} onChange={(event) => update("branchId", event.target.value)}><option value="">Tất cả trong phạm vi</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Trạng thái<select value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="">Tất cả</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Loại chiến dịch<select value={filters.campaignType} onChange={(event) => update("campaignType", event.target.value)}><option value="">Tất cả loại</option>{Object.entries(campaignTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Mức rủi ro<select value={filters.riskLevel} onChange={(event) => update("riskLevel", event.target.value)}><option value="">Tất cả mức</option>{Object.entries(riskLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Nhóm khách<select value={filters.segmentId} onChange={(event) => update("segmentId", event.target.value)}><option value="">Tất cả nhóm</option>{segmentItems.map((segment: any) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</select></label></div><div className={styles.filterBottom}><div className={styles.chips}><button className={!filters.status ? styles.chipActive : styles.chip} type="button" onClick={() => update("status", "")}>Tất cả</button>{["RUNNING", "SCHEDULED", "PENDING_APPROVAL", "FAILED"].map((status) => <button key={status} className={filters.status === status ? styles.chipActive : styles.chip} type="button" onClick={() => update("status", status)}>{status === "FAILED" ? "Cần chú ý" : statusLabel(status)}</button>)}</div><div className={styles.filterTools}><label>Từ ngày<input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /></label><label>Đến ngày<input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></label><label>Sắp xếp<select value={filters.sort} onChange={(event) => update("sort", event.target.value)}><option value="NEWEST">Mới nhất</option><option value="OLDEST">Cũ nhất</option><option value="SCHEDULE_ASC">Lịch gửi gần nhất</option><option value="AUDIENCE_DESC">Audience lớn nhất</option><option value="SENT_DESC">Đã gửi nhiều nhất</option></select></label><button className={styles.quiet} type="button" onClick={clearFilters}>Xóa bộ lọc</button></div></div></section><div className={styles.workspace}><section className={styles.tableCard}><div className={styles.tableHead}><div><h2>Danh sách chiến dịch</h2><small>{ready ? `${count(total)} chiến dịch trong phạm vi truy cập` : "Số liệu từ server"}</small></div><div className={styles.tableHeadActions}><span>{overview.state === "ready" ? `${count(overviewData.campaigns?.running)} đang chạy` : "—"}</span><a className={styles.textLink} href="/admin/marketing/segments">Nhóm khách hàng</a></div></div><StateMessage resource={directory} label="danh sách Campaign" empty="Chưa có chiến dịch Marketing phù hợp." />{ready && items.length > 0 ? <div className={styles.tableScroll}><table><caption className={styles.srOnly}>Danh sách chiến dịch Marketing</caption><thead><tr><th scope="col">Chiến dịch</th><th scope="col">Nhóm khách</th><th scope="col">Loại</th><th scope="col">Audience</th><th scope="col">Đã gửi</th><th scope="col">Đã chặn</th><th scope="col">Thất bại</th><th scope="col">Lịch gửi</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody>{items.map((item: any) => <tr key={item.id} className={selectedId === item.id ? styles.selected : ""} aria-selected={selectedId === item.id}><td><button className={styles.campaignButton} type="button" onClick={() => setSelectedId(String(item.id))}><strong>{item.name}</strong><small>{item.branch?.name ?? "Toàn salon"} · {item.requestedBy?.displayName ?? "Người tạo được giới hạn"}</small></button></td><td>{item.segment?.name ?? "—"}<small>v{item.segment?.version ?? "—"}</small></td><td>{typeLabel(item.campaignType)}<small>{riskLabels[item.riskLevel] ?? item.riskLevel}</small></td><td><AudienceBar audience={item.audience} /></td><td>{count(item.delivery?.sentCount)}</td><td>{count(item.delivery?.suppressedCount)}</td><td>{count(item.delivery?.failedCount)}</td><td>{formatDate(item.scheduledAt)}</td><td><StatusBadge value={item.status} /></td><td><button className={styles.rowAction} type="button" onClick={() => setSelectedId(String(item.id))}>Xem chi tiết <Icon name="arrowRight" /></button></td></tr>)}</tbody></table></div> : null}{ready && total > 0 ? <div className={styles.pagination}><span>Hiển thị {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, total)} trong {count(total)} chiến dịch</span><div className={styles.pager}><button type="button" disabled={filters.page <= 1} onClick={() => update("page", filters.page - 1)} aria-label="Trang trước">‹</button><b>{filters.page} / {Math.max(totalPages, 1)}</b><button type="button" disabled={filters.page >= totalPages} onClick={() => update("page", filters.page + 1)} aria-label="Trang sau">›</button><select value={filters.pageSize} aria-label="Số dòng mỗi trang" onChange={(event) => update("pageSize", Number(event.target.value))}><option value={10}>10 / trang</option><option value={20}>20 / trang</option><option value={50}>50 / trang</option></select></div></div> : null}</section><aside className={styles.rail} aria-label="Chi tiết chiến dịch"><CampaignInspector detail={selected.data} preview={preview} onAction={(name, date) => void action(name, date)} canApprove={canApprove} canSchedule={canSchedule} canCancel={canCancel} canCreate={canCreate} canReport={Boolean(authContext?.authorization?.permissions?.includes("marketing.report.read"))} mutation={mutation} /></aside></div><section className={styles.lowerGrid}><article className={styles.lowerCard}><div className={styles.lowerHead}><div><h2>Nhóm khách hàng nổi bật</h2><small>Chỉ hiển thị Segment thật trong quyền truy cập.</small></div><a className={styles.textLink} href="/admin/marketing/segments">Quản lý nhóm</a></div>{segments.state === "forbidden" ? <p className={styles.formHint}>Không có quyền xem nhóm khách hàng.</p> : segmentItems.length ? <div className={styles.segmentList}>{segmentItems.map((segment: any) => <div className={styles.segmentRow} key={segment.id}><div><strong>{segment.name}</strong><small>{filterSummary(segment.filterJson ?? segment.filter_json)} · Phiên bản {segment.version ?? "—"}</small></div><span className={styles.segmentCount}>{segment.status === "ACTIVE" ? "Đang dùng" : "—"}</span></div>)}</div> : <div className={styles.empty}><strong>Chưa có Segment đang hoạt động</strong><a className={styles.textLink} href="/admin/marketing/segments">Tạo nhóm khách hàng</a></div>}</article><article className={styles.lowerCard}><div className={styles.lowerHead}><div><h2>Lịch Campaign</h2><small>Lịch thực tế từ scheduledAt của Campaign.</small></div></div>{items.filter((item: any) => item.scheduledAt).slice(0, 5).length ? <div className={styles.calendarList}>{items.filter((item: any) => item.scheduledAt).slice(0, 5).map((item: any) => <div className={styles.calendarRow} key={item.id}><div><strong>{item.name}</strong><small>{formatDate(item.scheduledAt)} · {statusLabel(item.status)}</small></div><StatusBadge value={item.status} /></div>)}</div> : <div className={styles.empty}><strong>Chưa có lịch gửi</strong><span>Campaign chỉ xuất hiện sau khi được lên lịch từ trạng thái Đã duyệt.</span></div>}</article><article className={styles.lowerCard}><div className={styles.lowerHead}><div><h2>Campaign cần chú ý</h2><small>Đếm theo toàn bộ phạm vi server.</small></div></div><div className={styles.attentionList}><div className={styles.attentionRow}><div><strong>Chờ phê duyệt</strong><small>Chiến dịch cần người duyệt độc lập</small></div><span className={styles.segmentCount}>{count(summary.pendingApprovalCount)}</span></div><div className={styles.attentionRow}><div><strong>Campaign thất bại</strong><small>Kiểm tra failure code từ server</small></div><span className={styles.segmentCount}>{count(summary.failedCampaignCount)}</span></div><div className={styles.attentionRow}><div><strong>Email bị chặn</strong><small>Không phải lỗi provider</small></div><span className={styles.segmentCount}>{count(summary.messagesSuppressed)}</span></div></div></article></section><div className={styles.noticeCard}><strong>Consent and suppression (Consent và suppression) là điều kiện bắt buộc.</strong> Marketing Email chỉ được tạo cho Customer có consent phù hợp, Email đã xác thực và không bị suppression. Worker re-check các điều kiện này ngay trước khi gọi EmailProvider. Màn hình hiện không hiển thị Open, Click, Booking hay Revenue vì source chưa có tracking/attribution tương ứng.</div><CampaignCreateDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={() => void reload()} branches={branches} segments={rows(segments.data).filter((item) => item.status === "ACTIVE")} templates={templateItems} context={createContext.data} mutation={mutation} /></main>;
}
