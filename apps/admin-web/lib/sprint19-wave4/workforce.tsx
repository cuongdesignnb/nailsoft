/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import * as React from "react";
import { Field, Page, StatePanel, command, format, useMutation, useResource, wave4Text } from "./shared";

export function WorkforceWorkspace({ pathname }: { pathname: string }) {
  if (pathname === "/admin/workforce/compliance") return <WorkforceComplianceWorkspace />;
  if (pathname === "/admin/workforce/reports") return <WorkforceReportsWorkspace />;
  return <WorkforcePoliciesWorkspace />;
}

const policyStates: Record<string, string> = {
  ACTIVE: "Đang áp dụng",
  SUPERSEDED: "Đã thay thế",
  RETIRED: "Đã ngưng",
  DRAFT: "Bản nháp",
};

const reportStates: Record<string, string> = {
  OPEN: "Đang mở",
  CLOSED: "Đã kết thúc",
  REVIEW_REQUIRED: "Cần rà soát",
  ADJUSTED: "Đã điều chỉnh",
};

function recordId(value: unknown) {
  const id = String(value ?? "");
  return id ? `#${id.slice(0, 8)}` : "—";
}

function localizedState(value: unknown, map: Record<string, string>) {
  const key = String(value ?? "").toUpperCase();
  return map[key] ?? wave4Text(key) ?? "Cần kiểm tra";
}

function durationLabel(seconds: unknown) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "—";
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  return `${hours} giờ ${minutes} phút`;
}

function WorkforcePoliciesWorkspace() {
  const resource = useResource("/v1/workforce-compliance/policies");
  const rows = resource.rows;
  const activeCount = rows.filter((row) => String(row.status ?? "").toUpperCase() === "ACTIVE").length;
  const retiredCount = rows.filter((row) => ["RETIRED", "SUPERSEDED"].includes(String(row.status ?? "").toUpperCase())).length;
  return <Page eyebrow="Workforce" title="Chính sách nhân sự" description="Quy tắc cấu hình theo phiên bản, có kiểm soát rà soát pháp lý." actions={<button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.reload()}>Làm mới</button>}>
    <section className="s19-w4-policy-kpis" aria-label="Tổng quan chính sách">
      <article><span>Chính sách trong phạm vi</span><strong>{rows.length}</strong><p>Danh sách được máy chủ giới hạn theo quyền truy cập.</p></article>
      <article className="is-accent"><span>Đang áp dụng</span><strong>{activeCount}</strong><p>Chính sách có hiệu lực trong phạm vi hiện tại.</p></article>
      <article><span>Không còn áp dụng</span><strong>{retiredCount}</strong><p>Đã thay thế hoặc đã ngưng theo dữ liệu nguồn.</p></article>
    </section>
    <section className="s19-w4-policy-card">
      <header><div><span className="s19-payout-section-kicker">KIỂM SOÁT CHÍNH SÁCH</span><h2 className="s19-payout-section-title">Danh mục chính sách tuân thủ</h2><p>Chính sách được quản lý theo phiên bản; màn hình này chỉ hiển thị bằng chứng đọc từ máy chủ.</p></div><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span></header>
      <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có chính sách trong phạm vi được cấp quyền." />
      {resource.state === "ready" ? <div className="s19-w4-policy-table-wrap"><table className="s19-w4-policy-table"><thead><tr><th scope="col">Mã chính sách</th><th scope="col">Tên chính sách</th><th scope="col">Khu vực pháp lý</th><th scope="col">Trạng thái</th><th scope="col">Tạo lúc</th><th scope="col">Mã hệ thống</th></tr></thead><tbody>{rows.map((row) => { const status = String(row.status ?? "").toLowerCase(); return <tr key={String(row.id)}><td data-label="Mã chính sách"><strong>{row.code ?? "—"}</strong></td><td data-label="Tên chính sách">{row.name ?? "—"}</td><td data-label="Khu vực pháp lý">{row.jurisdictionCode ?? "Không khai báo"}</td><td data-label="Trạng thái"><span className={`s19-w4-policy-state is-${status}`}>{localizedState(row.status, policyStates)}</span></td><td data-label="Tạo lúc">{format(row.createdAt, "createdAt")}</td><td data-label="Mã hệ thống"><span title={String(row.id ?? "")}>{recordId(row.id)}</span></td></tr>; })}</tbody></table></div> : null}
    </section>
    <section className="s19-w4-policy-note"><strong>Ranh giới an toàn</strong><p>Việc tạo phiên bản, kích hoạt hoặc ngưng chính sách phải đi qua lệnh quản trị có kiểm soát. Không chỉnh sửa trực tiếp dữ liệu chính sách từ bảng đọc này.</p></section>
  </Page>;
}

function WorkforceReportsWorkspace() {
  const resource = useResource("/v1/workforce/reports/attendance");
  const report = resource.rows[0] ?? {};
  const sessions = Array.isArray(report.sessions) ? report.sessions as Array<Record<string, any>> : [];
  const closedCount = sessions.filter((row) => ["CLOSED", "ADJUSTED"].includes(String(row.state ?? "").toUpperCase())).length;
  const openCount = sessions.filter((row) => String(row.state ?? "").toUpperCase() === "OPEN").length;
  const payableSeconds = sessions.reduce((sum, row) => { const seconds = Number(row.payableSeconds); return sum + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0); }, 0);
  return <Page eyebrow="Workforce" title="Báo cáo chấm công" description="Bằng chứng chấm công, thời gian làm việc và trạng thái phiên theo phạm vi được cấp quyền." actions={<button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.reload()}>Làm mới báo cáo</button>}>
    <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có dữ liệu báo cáo trong phạm vi được cấp quyền." />
    {resource.state === "ready" ? <>
      <section className="s19-w4-report-kpis" aria-label="Tóm tắt báo cáo">
        <article><span>Phiên trong báo cáo</span><strong>{sessions.length}</strong><p>Phiên chấm công trong dữ liệu máy chủ trả về.</p></article>
        <article className="is-accent"><span>Đã kết thúc</span><strong>{closedCount}</strong><p>Phiên đã đóng hoặc đã được điều chỉnh.</p></article>
        <article><span>Đang mở</span><strong>{openCount}</strong><p>Cần tiếp tục theo dõi tại chấm công.</p></article>
        <article><span>Giờ được tính</span><strong>{durationLabel(payableSeconds)}</strong><p>Tổng từ trường payableSeconds của các phiên.</p></article>
      </section>
      <section className="s19-w4-report-card">
        <header><div><span className="s19-payout-section-kicker">BẰNG CHỨNG CHẤM CÔNG</span><h2 className="s19-payout-section-title">Chi tiết phiên làm việc</h2><p>{report.generatedAt ? `Cập nhật lúc ${format(report.generatedAt, "generatedAt")}.` : "Báo cáo lấy trực tiếp từ dữ liệu phiên chấm công."}</p></div><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span></header>
        {sessions.length ? <div className="s19-w4-report-table-wrap"><table className="s19-w4-report-table"><thead><tr><th scope="col">Bắt đầu</th><th scope="col">Kết thúc</th><th scope="col">Nhân sự</th><th scope="col">Chi nhánh</th><th scope="col">Trạng thái</th><th scope="col">Giờ thường</th><th scope="col">Giờ thêm</th><th scope="col">Giờ được tính</th></tr></thead><tbody>{sessions.map((row) => { const state = String(row.state ?? "").toLowerCase(); return <tr key={String(row.id)}><td data-label="Bắt đầu">{format(row.startedAt, "startedAt")}</td><td data-label="Kết thúc">{format(row.endedAt, "endedAt")}</td><td data-label="Nhân sự"><span title={String(row.staffId ?? "")}>{recordId(row.staffId)}</span></td><td data-label="Chi nhánh"><span title={String(row.branchId ?? "")}>{recordId(row.branchId)}</span></td><td data-label="Trạng thái"><span className={`s19-w4-report-state is-${state}`}>{localizedState(row.state, reportStates)}</span></td><td data-label="Giờ thường">{durationLabel(row.regularSeconds)}</td><td data-label="Giờ thêm">{durationLabel(row.overtimeSeconds)}</td><td data-label="Giờ được tính"><strong>{durationLabel(row.payableSeconds)}</strong></td></tr>; })}</tbody></table></div> : <div className="s19-w4-report-empty"><strong>Chưa có phiên chấm công</strong><p>Máy chủ chưa trả về phiên phù hợp với phạm vi hiện tại.</p></div>}
      </section>
      <section className="s19-w4-report-note"><strong>Cách đọc báo cáo</strong><p>Giờ được tính lấy từ payableSeconds do dịch vụ Workforce trả về. Báo cáo không tự suy diễn ca làm, tiền lương hoặc trạng thái ngoại lệ ngoài dữ liệu nguồn.</p></section>
    </> : null}
  </Page>;
}

const exceptionTypes: Record<string, string> = {
  EXCESSIVE_SESSION_DURATION: "Phiên làm việc vượt ngưỡng",
  MISSED_CLOCK_OUT: "Thiếu lượt kết ca",
};
const exceptionSeverities: Record<string, string> = { BLOCKING: "Bắt buộc xử lý", WARNING: "Cảnh báo" };
const exceptionStates: Record<string, string> = { OPEN: "Đang mở", ACKNOWLEDGED: "Đã xác nhận", RESOLVED: "Đã xử lý", WAIVED: "Đã miễn trừ" };

function exceptionLabel(value: unknown, map: Record<string, string>) {
  const key = String(value ?? "").toUpperCase();
  return map[key] ?? wave4Text(key) ?? "Cần kiểm tra";
}

function WorkforceComplianceWorkspace() {
  const resource = useResource("/v1/time-clock/exceptions");
  const mutation = useMutation(resource.reload);
  const rows = resource.rows;
  const openCount = rows.filter((row) => ["OPEN", "ACKNOWLEDGED"].includes(String(row.state ?? "").toUpperCase())).length;
  const blockingCount = rows.filter((row) => String(row.severity ?? "").toUpperCase() === "BLOCKING" && !["RESOLVED", "WAIVED"].includes(String(row.state ?? "").toUpperCase())).length;
  return <Page eyebrow="Workforce" title="Tuân thủ nhân sự" description="Ngoại lệ chấm công được đọc từ máy chủ; mọi xác nhận, xử lý và miễn trừ đều giữ bằng chứng phiên bản.">
    <section className="s19-w4-compliance-kpis" aria-label="Tổng quan tuân thủ">
      <article className="s19-w4-compliance-kpi"><span>Tổng ngoại lệ</span><strong>{rows.length}</strong><p>Trong phạm vi chi nhánh hiện tại.</p></article>
      <article className="s19-w4-compliance-kpi s19-w4-compliance-kpi-accent"><span>Đang cần xử lý</span><strong>{openCount}</strong><p>Đang mở hoặc đã xác nhận.</p></article>
      <article className="s19-w4-compliance-kpi"><span>Ngoại lệ bắt buộc</span><strong>{blockingCount}</strong><p>Không thể bỏ qua nếu còn hiệu lực.</p></article>
    </section>
    <section className="s19-card">
      <div className="s19-w4-toolbar"><div><span className="s19-payout-section-kicker">BẰNG CHỨNG CHẤM CÔNG</span><h2 className="s19-payout-section-title">Danh sách ngoại lệ</h2><p className="s19-helper">Thông tin nhân sự và chi nhánh chỉ dùng dữ liệu đã được API giới hạn theo quyền truy cập.</p></div><div className="s19-page-heading-actions"><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.reload()}>Làm mới</button></div></div>
      <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có ngoại lệ chấm công trong phạm vi được cấp quyền." />
      {resource.state === "ready" ? <div className="s19-w4-compliance-table-wrap"><table className="s19-w4-compliance-table"><thead><tr><th scope="col">Ngoại lệ</th><th scope="col">Nhân sự</th><th scope="col">Chi nhánh</th><th scope="col">Mức độ</th><th scope="col">Trạng thái</th><th scope="col">Phát hiện</th><th scope="col">Thao tác</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td data-label="Ngoại lệ"><strong>{exceptionLabel(row.exceptionType, exceptionTypes)}</strong><small>#{String(row.id ?? "").slice(0, 8)}</small></td><td data-label="Nhân sự">#{String(row.staffId ?? "").slice(0, 8)}</td><td data-label="Chi nhánh">#{String(row.branchId ?? "").slice(0, 8)}</td><td data-label="Mức độ"><span className={`s19-w4-compliance-severity is-${String(row.severity ?? "").toLowerCase()}`}>{exceptionLabel(row.severity, exceptionSeverities)}</span></td><td data-label="Trạng thái"><span className={`s19-w4-compliance-state is-${String(row.state ?? "").toLowerCase()}`}>{exceptionLabel(row.state, exceptionStates)}</span></td><td data-label="Phát hiện">{format(row.createdAt, "createdAt")}</td><td data-label="Thao tác"><ExceptionActions row={row} mutation={mutation} /></td></tr>)}</tbody></table></div> : null}
      {mutation.notice ? <p className="s19-notice s19-notice-success" role="status">{mutation.notice}</p> : null}{mutation.error ? <p className="s19-notice s19-notice-danger" role="alert">{mutation.error}</p> : null}
    </section>
  </Page>;
}

function ExceptionActions({ row, mutation }: { row: Record<string, any>; mutation: ReturnType<typeof useMutation> }) {
  const state = String(row.state ?? "").toUpperCase();
  const [showReason, setShowReason] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (state === "OPEN") return <button className="s19-button s19-button-secondary" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/v1/time-clock/exceptions/${row.id}/acknowledge`, { version: row.version })}>Xác nhận</button>;
  if (state === "ACKNOWLEDGED") return <div className="s19-w4-compliance-actions"><button className="s19-button s19-button-secondary" type="button" disabled={mutation.busy} onClick={() => setShowReason((value) => !value)}>{showReason ? "Đóng" : "Xử lý"}</button>{showReason ? <form className="s19-w4-compliance-reason" onSubmit={(event) => { event.preventDefault(); if (!reason.trim()) return; void mutation.run(`/v1/time-clock/exceptions/${row.id}/resolve`, { version: row.version, reason: reason.trim() }); }}><label><span>Lý do xử lý</span><input aria-label="Lý do xử lý" required value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="s19-button s19-button-secondary" type="submit" disabled={mutation.busy || !reason.trim()}>Đánh dấu đã xử lý</button><button className="s19-button s19-button-ghost" type="button" disabled={mutation.busy || !reason.trim()} onClick={() => void mutation.run(`/v1/time-clock/exceptions/${row.id}/waive`, { version: row.version, reason: reason.trim() })}>Miễn trừ</button></form> : null}</div>;
  return <span className="s19-w4-compliance-muted">Không có thao tác</span>;
}

export function PayProfileWorkspace({ staffId }: { staffId: string }) {
  const resource = useResource(`/v1/staff/${staffId}/pay-profile`);
  const row = resource.rows[0] ?? {};
  return <Page eyebrow="Nhân sự" title="Hồ sơ lương nhân sự" description="Cấu hình loại hồ sơ và thời điểm hiệu lực. Mọi thay đổi đều được máy chủ ghi nhận theo phiên bản.">
    <section className="s19-card">
      <div className="s19-w4-toolbar">
        <div><span className="s19-payout-section-kicker">THIẾT LẬP LƯƠNG</span><h2 className="s19-payout-section-title">Cấu hình theo thời điểm hiệu lực</h2><p className="s19-helper">Thông tin hiển thị thuộc đúng nhân sự được chọn và bị giới hạn theo quyền truy cập.</p></div>
        <span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span>
      </div>
      <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Pay profile has not been initialized." />
      {resource.state === "ready" && <>
        <dl className="s19-w4-dl">
          {[["Profile type", row.profileType], ["Currency", row.currency], ["Effective from", row.effectiveFrom], ["Effective to", row.effectiveTo], ["Status", row.status], ["Version", row.version]].map(([label, value]) => <div key={label as string}><dt>{wave4Text(label as string)}</dt><dd>{label === "Effective from" || label === "Effective to" ? format(value, String(label)) : label === "Version" ? format(value, "version") : wave4Text(String(value ?? "—").toUpperCase())}</dd></div>)}
        </dl>
        <PayProfileForm staffId={staffId} row={row} onSaved={resource.reload} />
      </>}
    </section>
  </Page>;
}
function PayProfileForm({ staffId, row, onSaved }: { staffId: string; row: Record<string, any>; onSaved: () => Promise<void> }) {
  const [profileType, setProfileType] = React.useState(String(row.profileType ?? "HOURLY").toUpperCase());
  const [currency, setCurrency] = React.useState(String(row.currency ?? "VND").toUpperCase());
  const [effectiveFrom, setEffectiveFrom] = React.useState(String(row.effectiveFrom ?? "").slice(0, 10));
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const intent = React.useRef<{ fingerprint: string; key: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const payload = { profileType, currency: currency.trim().toUpperCase(), effectiveFrom: effectiveFrom || null, effectiveTo: null };
    const fingerprint = JSON.stringify(payload);
    if (!intent.current || intent.current.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true); setNotice(""); setError("");
    try {
      await command(`/v1/staff/${staffId}/pay-profile/update`, payload, "POST", intent.current.key);
      intent.current = null;
      await onSaved();
      setNotice(wave4Text("Saved successfully"));
    } catch (cause: any) {
      setError(wave4Text(cause?.message ?? "Unable to save pay profile"));
    } finally { setBusy(false); }
  }
  return <form className="s19-form-grid s19-w4-subform" onSubmit={save}>
    <label className="s19-field"><span>{wave4Text("Profile type")}</span><select name="profileType" value={profileType} onChange={(e) => setProfileType(e.target.value)}><option value="HOURLY">{wave4Text("HOURLY")}</option><option value="SALARY">{wave4Text("SALARY")}</option><option value="COMMISSION_ONLY">{wave4Text("COMMISSION_ONLY")}</option><option value="HOURLY_PLUS_COMMISSION">{wave4Text("HOURLY_PLUS_COMMISSION")}</option><option value="SALARY_PLUS_COMMISSION">{wave4Text("SALARY_PLUS_COMMISSION")}</option></select></label>
    <Field label="Currency" name="currency" value={currency} onChange={setCurrency} required />
    <Field label="Effective from" name="effectiveFrom" type="date" value={effectiveFrom} onChange={setEffectiveFrom} required />
    <div className="s19-field s19-w4-form-note"><span>Nguyên tắc cập nhật</span><p>Thay đổi được kiểm tra và ghi nhận bởi máy chủ; không sửa ngược dữ liệu kỳ lương đã chốt.</p></div>
    <button className="s19-button s19-button-primary" disabled={busy}>{busy ? wave4Text("Saving…") : wave4Text("Save pay profile")}</button>
    {notice && <p className="s19-notice s19-notice-success s19-field-wide" role="status">{notice}</p>}
    {error && <p className="s19-notice s19-notice-danger s19-field-wide" role="alert">{error}</p>}
  </form>;
}
