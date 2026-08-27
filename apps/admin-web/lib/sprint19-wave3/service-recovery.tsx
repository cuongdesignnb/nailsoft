"use client";

import { FormEvent, useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, formatDate, localized, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";
import { useCustomerLookup } from "./benefit-shared";

const sources = ["LOW_REVIEW", "CUSTOMER_COMPLAINT", "STAFF_REPORT", "REFUND_ESCALATION", "SERVICE_FAILURE", "MANUAL"];
const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const compensationTypes = ["CUSTOMER_CREDIT", "LOYALTY_POINTS", "VOUCHER", "COMPLIMENTARY_SERVICE_FOUNDATION", "NO_MONETARY_COMPENSATION"];
const sourceLabels: Record<string, string> = { LOW_REVIEW: "Đánh giá thấp", CUSTOMER_COMPLAINT: "Khiếu nại khách hàng", STAFF_REPORT: "Báo cáo nội bộ", REFUND_ESCALATION: "Escalation từ Refund", SERVICE_FAILURE: "Lỗi dịch vụ", MANUAL: "Tạo thủ công" };
const compensationLabels: Record<string, string> = { CUSTOMER_CREDIT: "Store Credit", LOYALTY_POINTS: "Điểm Loyalty", VOUCHER: "Voucher", COMPLIMENTARY_SERVICE_FOUNDATION: "Dịch vụ bù", NO_MONETARY_COMPENSATION: "Không bồi hoàn tiền" };
const protectedReference = "Mã tham chiếu được bảo vệ";

function safePublicReference(value: unknown, fallback = protectedReference) {
  const text = String(value ?? "").trim();
  return text && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text) ? text : fallback;
}

function RecoveryCreate() {
  const branches = useBenefitResource("/v1/branches");
  const customerLookup = useCustomerLookup();
  const mutation = useBenefitMutation();
  const [branchId, setBranchId] = useState(""); const [customerId, setCustomerId] = useState(""); const [source, setSource] = useState(sources[0]); const [severity, setSeverity] = useState(severities[0]); const [category, setCategory] = useState(""); const [summary, setSummary] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = await mutation.submit("/v1/service-recovery/cases", { branchId, customerId, source, severity, category: category.trim(), summary: summary.trim() }); if (result) { setSummary(""); setCategory(""); } }
  return <form className="s19-card s19-form-grid" onSubmit={submit}><h2>Mở hồ sơ Service Recovery</h2><label className="s19-field"><span>Chi nhánh</span><select value={branchId} required onChange={(event) => setBranchId(event.target.value)}><option value="">Chọn chi nhánh</option>{rows(branches.data).map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, "Chi nhánh được bảo vệ")}</option>)}</select></label><div className="s19-field"><span>Khách hàng</span><div className="s19-inline-actions"><input aria-label="Tìm khách hàng" value={customerLookup.query} onChange={(event) => customerLookup.setQuery(event.target.value)} placeholder="Tìm theo tên hoặc liên hệ" /><button className="s19-button s19-button-secondary" type="button" onClick={() => customerLookup.search()}>Tìm</button></div>{customerLookup.results.length > 0 && <select aria-label="Kết quả khách hàng" value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Chọn khách hàng</option>{customerLookup.results.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName ?? "Khách hàng được bảo vệ"}</option>)}</select>}</div><label className="s19-field"><span>Nguồn phát sinh</span><select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map((item) => <option key={item} value={item}>{sourceLabels[item] ?? item}</option>)}</select></label><label className="s19-field"><span>Mức độ</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}>{severities.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label><label className="s19-field"><span>Phân loại</span><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Chất lượng dịch vụ" /></label><label className="s19-field"><span>Tóm tắt sự việc</span><textarea required rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Mô tả vấn đề ảnh hưởng tới khách hàng" /></label><p className="s19-helper">Bồi hoàn là một yêu cầu kiểm soát kép riêng. Mở hồ sơ không tự thay đổi số dư.</p><button className="s19-button s19-button-primary" type="submit">Tạo hồ sơ</button><Notice mutation={mutation} /></form>;
}

export function RecoveryCases() {
  const resource = useBenefitResource("/v1/service-recovery/cases");
  return <EngagementShell title="Service Recovery"><div className="s19-benefit-layout"><RecoveryCreate /><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">AN TOÀN KHÁCH HÀNG</p><h2>Hồ sơ đang theo dõi</h2></div></div><EngagementStates resource={resource} label="hồ sơ Service Recovery" /><SafeTable data={rows(resource.data)} columns={[{ key: "id", label: "Hồ sơ", render: (row) => <a href={`/admin/service-recovery/${row.id}`}>{safePublicReference(row.caseReference ?? row.id)}</a> }, { key: "customerId", label: "Khách hàng", render: (row) => row.customerDisplayName ?? "Khách hàng được bảo vệ" }, { key: "source", label: "Nguồn", render: (row) => sourceLabels[String(row.source)] ?? statusLabel(row.source) }, { key: "severity", label: "Mức độ", render: (row) => <span className="s19-status s19-status-warning">{statusLabel(row.severity)}</span> }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) }, { key: "updatedAt", label: "Cập nhật", render: (row) => formatDate(row.updatedAt ?? row.updated_at) }]} /></section></div></EngagementShell>;
}

function recoveryActions(status: string) {
  if (status === "OPEN") return ["triage", "cancel"];
  if (status === "TRIAGED") return ["start", "cancel"];
  if (status === "IN_PROGRESS") return ["wait-customer", "resolve", "cancel"];
  if (status === "WAITING_CUSTOMER") return ["start", "resolve"];
  if (status === "RESOLVED") return ["close"];
  return [];
}

function compensationHref(type: string) {
  if (type === "CUSTOMER_CREDIT") return "/admin/stored-value/adjustments";
  if (type === "LOYALTY_POINTS") return "/admin/loyalty/adjustments";
  if (type === "VOUCHER") return "/admin/vouchers/codes";
  return undefined;
}

export function RecoveryDetail({ caseId }: { caseId: string }) {
  const resource = useBenefitResource(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}`);
  const mutation = useBenefitMutation();
  const [compensationType, setCompensationType] = useState(compensationTypes[0]); const [compensationNote, setCompensationNote] = useState("");
  const recovery = resource.data?.case ?? resource.data ?? {};
  const status = String(recovery.status ?? "UNKNOWN");
  async function transition(action: string) { const result = await mutation.submit(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}/${action}`, { version: recovery.version, reason: "Reviewed in Admin Web", ...(action === "resolve" ? { resolution: "Resolution recorded after operational review." } : {}) }); if (result) await resource.load(); }
  async function requestCompensation(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const result = await mutation.submit(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}/compensations`, { compensationType, proposal: { note: compensationNote.trim() }, reason: "Customer recovery proposal" }); if (result) { setCompensationNote(""); await resource.load(); } }
  const compensations = rows(recovery.compensations ?? resource.data?.compensations);
  const tasks = rows(recovery.tasks ?? resource.data?.tasks);
  return <EngagementShell title={safePublicReference(recovery.caseReference, "Hồ sơ Service Recovery")}><EngagementStates resource={resource} label="hồ sơ Service Recovery" />{resource.state === "ready" && <><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">DÒNG THỜI GIAN HỒ SƠ</p><h2>{statusLabel(status)}</h2></div><span className="s19-status s19-status-info">{statusLabel(recovery.severity)}</span></div><dl className="s19-definition-grid"><div><dt>Khách hàng</dt><dd>{recovery.customerDisplayName ?? "Khách hàng được bảo vệ"}</dd></div><div><dt>Chi nhánh</dt><dd>{recovery.branchName ?? "Chi nhánh được bảo vệ"}</dd></div><div><dt>Nguồn</dt><dd>{sourceLabels[String(recovery.source)] ?? statusLabel(recovery.source)}</dd></div><div><dt>Phân loại</dt><dd>{recovery.category ?? "-"}</dd></div></dl><p className="s19-quote">{recovery.summary ?? "Chưa có tóm tắt."}</p><VersionActions mutation={mutation} version={recovery.version} actions={recoveryActions(status)} onAction={(action) => void transition(action)} /></section><section className="s19-card"><h2>Đề xuất bồi hoàn</h2><form className="s19-form-grid" onSubmit={requestCompensation}><label className="s19-field"><span>Loại bồi hoàn</span><select value={compensationType} onChange={(event) => setCompensationType(event.target.value)}>{compensationTypes.map((type) => <option key={type} value={type}>{compensationLabels[type] ?? type}</option>)}</select></label><label className="s19-field"><span>Ghi chú đề xuất</span><textarea required rows={3} value={compensationNote} onChange={(event) => setCompensationNote(event.target.value)} placeholder="Giải thích đề xuất chăm sóc khách hàng" /></label><p className="s19-helper">Phê duyệt độc lập với người tạo yêu cầu. Số dư chỉ thay đổi qua domain sở hữu.</p><button className="s19-button s19-button-primary" type="submit">Gửi yêu cầu phê duyệt</button></form><SafeTable data={compensations} columns={[{ key: "compensationType", label: "Loại", render: (row) => compensationHref(row.compensationType) ? <a href={compensationHref(row.compensationType)}>{compensationLabels[row.compensationType] ?? statusLabel(row.compensationType)}</a> : compensationLabels[row.compensationType] ?? statusLabel(row.compensationType) }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) }, { key: "requestedByUserId", label: "Người tạo", render: () => "Người dùng được bảo vệ" }, { key: "approvedByUserId", label: "Người duyệt", render: () => "Người dùng được bảo vệ" }, { key: "actions", label: "Thao tác", render: (row) => String(row.status).toUpperCase() === "PENDING_APPROVAL" ? <VersionActions mutation={mutation} version={row.version} actions={["approve", "reject"]} onAction={(action) => void mutation.submit(`/v1/service-recovery/compensations/${row.id}/${action}`, { version: row.version, reason: "Reviewed in Admin Web" }).then(() => resource.load())} /> : "-" }]} /></section><section className="s19-card"><h2>Công việc được giao</h2><SafeTable data={tasks} columns={[{ key: "title", label: "Công việc", render: (row) => row.title ?? row.taskType ?? "Công việc" }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) }, { key: "assignedToUserId", label: "Người phụ trách", render: () => "Người dùng được bảo vệ" }, { key: "updatedAt", label: "Cập nhật", render: (row) => formatDate(row.updatedAt ?? row.createdAt) }]} /></section></>}<Notice mutation={mutation} /></EngagementShell>;
}

export function RecoveryRoute({ pathname }: { pathname: string }) { const detail = pathname.match(/^\/admin\/service-recovery\/([^/]+)$/); return detail ? <RecoveryDetail caseId={detail[1] ?? ""} /> : <RecoveryCases />; }
