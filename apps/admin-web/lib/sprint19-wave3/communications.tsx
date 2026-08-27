"use client";

import { FormEvent, useState } from "react";
import {
  EngagementShell,
  EngagementStates,
  Notice,
  SafeTable,
  VersionActions,
  formatDate,
  localized,
  rows,
  statusLabel,
  useBenefitMutation,
  useBenefitResource,
} from "./engagement-shared";

const eventLabels: Record<string, string> = { "appointment.checked_in": "Khách đã đến", "appointment.confirmed": "Xác nhận lịch hẹn", "appointment.reminder": "Nhắc lịch", "appointment.completed": "Hoàn tất lịch hẹn", "review.requested": "Yêu cầu đánh giá", "service_recovery.created": "Tạo hồ sơ Service Recovery", "marketing.campaign_scheduled": "Chiến dịch Marketing đến lịch", "APPOINTMENT.CONFIRMED": "Xác nhận lịch hẹn", "APPOINTMENT.REMINDER": "Nhắc lịch", "REVIEW.REQUESTED": "Yêu cầu đánh giá", "SERVICE_RECOVERY.CREATED": "Tạo hồ sơ Service Recovery", "MARKETING.CAMPAIGN_SCHEDULED": "Chiến dịch Marketing đến lịch" };
const purposeLabels: Record<string, string> = { TRANSACTIONAL: "Giao dịch", MARKETING: "Marketing", REVIEW_REQUEST: "Yêu cầu đánh giá", SERVICE_RECOVERY: "Service Recovery", APPOINTMENT_REMINDER: "Nhắc lịch", APPOINTMENT_CONFIRMATION: "Xác nhận lịch hẹn" };

function eventLabel(value: unknown) {
  const raw = String(value ?? "");
  return eventLabels[raw] ?? eventLabels[raw.toLowerCase()] ?? raw.replaceAll("_", " ").replaceAll(".", " · ");
}

function purposeLabel(value: unknown) {
  const raw = String(value ?? "");
  return purposeLabels[raw] ?? raw.replaceAll("_", " ");
}

function Field({ label, name, value, onChange, type = "text", required = false, placeholder }: { label: string; name: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="s19-field"><span>{label}</span><input name={name} type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function FormCard({ title, children, onSubmit, submitLabel = "Tạo" }: { title: string; children: React.ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string }) {
  return <form className="s19-card s19-form-grid" onSubmit={onSubmit}><h2>{title}</h2>{children}<div className="s19-inline-actions"><button className="s19-button s19-button-primary" type="submit">{submitLabel}</button></div></form>;
}

export function CommunicationTemplates() {
  const resource = useBenefitResource("/v1/communications/templates");
  const mutation = useBenefitMutation();
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("TRANSACTIONAL");
  const data = rows(resource.data);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutation.submit("/v1/communications/templates", { code: code.trim(), category });
    if (result) { setCode(""); await resource.load(); }
  }
  return <EngagementShell title="Communication templates">
    <div className="s19-benefit-layout"><FormCard title="Tạo mẫu Email" onSubmit={submit}><Field label="Mã mẫu" name="code" value={code} onChange={setCode} required placeholder="appointment-reminder" /><label className="s19-field"><span>Phân loại</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>TRANSACTIONAL</option><option>ENGAGEMENT</option><option>MARKETING</option><option>INTERNAL</option></select></label></FormCard>
      <section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">NỘI DUNG THEO PHIÊN BẢN</p><h2>Danh sách mẫu Email</h2></div><span className="s19-status s19-status-info">{data.length} mẫu</span></div><EngagementStates resource={resource} label="mẫu Email" /><SafeTable data={data} columns={[{ key: "code", label: "Mã mẫu" }, { key: "category", label: "Phân loại", render: (row) => statusLabel(row.category) }, { key: "status", label: "Trạng thái", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status ?? row.lifecycleStatus ?? "DRAFT")}</span> }, { key: "activeVersion", label: "Phiên bản", render: (row) => row.activeVersion ?? row.active_version ?? row.version ?? "-" }, { key: "updatedAt", label: "Cập nhật", render: (row) => formatDate(row.updatedAt ?? row.updated_at) }]} /></section></div><Notice mutation={mutation} />
  </EngagementShell>;
}

export function CommunicationRules() {
  const resource = useBenefitResource("/v1/communications/rules");
  const marketingVersions = useBenefitResource("/v1/communications/templates/marketing-versions");
  const mutation = useBenefitMutation();
  const [domainEvent, setDomainEvent] = useState("appointment.checked_in");
  const [purpose, setPurpose] = useState("TRANSACTIONAL");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [branchId, setBranchId] = useState("");
  const branches = useBenefitResource("/v1/branches");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutation.submit("/v1/communications/rules", { domainEvent, purpose, templateVersionId: templateVersionId.trim(), branchId: branchId || null, delaySeconds: 0, recipientResolver: "APPOINTMENT_CUSTOMER", eligibilityPolicy: {} });
    if (result) { setTemplateVersionId(""); await resource.load(); }
  }
  const branchRows = rows(branches.data);
  const versionRows = rows(marketingVersions.data);
  return <EngagementShell title="Communication rules"><div className="s19-benefit-layout"><FormCard title="Tạo quy tắc gửi" onSubmit={submit}><label className="s19-field"><span>Sự kiện nghiệp vụ</span><select value={domainEvent} onChange={(event) => setDomainEvent(event.target.value)}>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="s19-field"><span>Mục đích</span><select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="s19-field"><span>Phiên bản mẫu Email đang hoạt động</span><select value={templateVersionId} required onChange={(event) => setTemplateVersionId(event.target.value)}><option value="">Chọn mẫu Email</option>{versionRows.map((version) => <option key={version.templateVersionId} value={version.templateVersionId}>{version.code} · {version.locale} · v{version.versionNumber}{version.subject ? ` · ${version.subject}` : ""}</option>)}</select>{marketingVersions.state === "loading" ? <small>Đang tải mẫu Marketing…</small> : marketingVersions.state === "empty" ? <small>Chưa có phiên bản mẫu Marketing đang hoạt động.</small> : null}</label><label className="s19-field"><span>Phạm vi chi nhánh</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Toàn salon (chỉ Owner)</option>{branchRows.map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, "Chi nhánh được bảo vệ")}</option>)}</select></label></FormCard><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">MÁY CHỦ LÀ NGUỒN SỰ THẬT</p><h2>Quy tắc gửi</h2></div></div><EngagementStates resource={resource} label="quy tắc gửi" /><SafeTable data={rows(resource.data)} columns={[{ key: "domainEvent", label: "Sự kiện", render: (row) => eventLabel(row.domainEvent ?? row.domain_event) }, { key: "purpose", label: "Mục đích", render: (row) => purposeLabel(row.purpose) }, { key: "branchId", label: "Chi nhánh", render: (row) => row.branchName ?? "Chi nhánh được bảo vệ" }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) }, { key: "actions", label: "Thao tác", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={row.status === "ACTIVE" ? ["pause", "deactivate"] : row.status === "PAUSED" ? ["activate", "deactivate"] : ["activate"]} onAction={(action) => void mutation.submit(`/v1/communications/rules/${row.id}/${action}`, { version: row.version }) .then(() => resource.load())} /> }]} /></section></div><Notice mutation={mutation} /></EngagementShell>;
}

function MessageTable({ resource, title }: { resource: ReturnType<typeof useBenefitResource>; title: string }) {
  return <section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">BẰNG CHỨNG GIAO NHẬN</p><h2>{title}</h2></div></div><EngagementStates resource={resource} label="Email" /><SafeTable data={rows(resource.data)} columns={[{ key: "id", label: "Mã Email", render: (row) => row.id ? <a href={`/admin/communications/messages/${encodeURIComponent(String(row.id))}`}>{row.messageReference ?? row.reference ?? "Mã Email được bảo vệ"}</a> : "Mã Email được bảo vệ" }, { key: "purpose", label: "Mục đích", render: (row) => purposeLabels[String(row.purpose)] ?? statusLabel(row.purpose) }, { key: "channel", label: "Kênh", render: (row) => row.channel ? statusLabel(row.channel) : "Email" }, { key: "status", label: "Trạng thái", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status)}</span> }, { key: "suppression", label: "Lý do chặn", render: (row) => row.suppressionReason ?? row.safeErrorCode ?? "-" }, { key: "createdAt", label: "Tạo lúc", render: (row) => formatDate(row.createdAt ?? row.created_at) }, { key: "actions", label: "Thao tác", render: (row) => row.id ? <a className="s19-button s19-button-secondary s19-button-small" href={`/admin/communications/messages/${encodeURIComponent(String(row.id))}`}>Xem chi tiết</a> : "—" }]} /></section>;
}

export function CommunicationMessages({ suppressions = false }: { suppressions?: boolean }) {
  const resource = useBenefitResource("/v1/communications/messages");
  const messageRows = suppressions ? rows(resource.data).filter((row) => String(row.status).toUpperCase() === "SUPPRESSED") : rows(resource.data);
  return <EngagementShell title={suppressions ? "Contact suppressions" : "Message delivery"} eyebrow="CUSTOMER ENGAGEMENT · CONTACT SAFETY"><MessageTable resource={{ ...resource, data: messageRows, state: messageRows.length ? "ready" : resource.state }} title={suppressions ? "Email bị chặn gửi" : "Email gần đây"} /></EngagementShell>;
}
