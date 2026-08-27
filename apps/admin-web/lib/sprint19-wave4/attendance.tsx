"use client";
import { useState } from "react";
import { Page, StatePanel, Table, format, useMutation, useResource, wave4Text } from "./shared";

type AttendanceRow = Record<string, unknown>;
type AttendanceKind = "live" | "sessions" | "exceptions" | "devices" | "timesheets" | "periods";

type AttendanceConfig = {
  kind: AttendanceKind;
  title: string;
  endpoint: string;
  description: string;
  empty: string;
};

const attendanceConfig: Record<string, AttendanceConfig> = {
  "/admin/time-clock": { kind: "live", title: "Chấm công thời gian thực", endpoint: "/v1/time-clock/sessions", description: "Theo dõi phiên chấm công theo thời gian máy chủ và trạng thái hiện tại của nhân sự.", empty: "Chưa có phiên chấm công trong phạm vi được cấp quyền." },
  "/admin/time-clock/sessions": { kind: "sessions", title: "Phiên chấm công", endpoint: "/v1/time-clock/sessions", description: "Đối chiếu thời điểm bắt đầu, kết thúc và số giờ được tính từ phiên chấm công.", empty: "Chưa có phiên chấm công trong phạm vi được cấp quyền." },
  "/admin/time-clock/exceptions": { kind: "exceptions", title: "Ngoại lệ chấm công", endpoint: "/v1/time-clock/exceptions", description: "Rà soát các phiên thiếu lượt chấm hoặc vượt ngưỡng bằng bằng chứng và thao tác có phiên bản.", empty: "Chưa có ngoại lệ chấm công trong phạm vi được cấp quyền." },
  "/admin/time-clock/devices": { kind: "devices", title: "Thiết bị chấm công", endpoint: "/v1/time-clock/devices", description: "Theo dõi kiosk và thiết bị gắn với chi nhánh; thu hồi chỉ thực hiện qua lệnh máy chủ.", empty: "Chưa có thiết bị chấm công trong phạm vi được cấp quyền." },
  "/admin/timesheets": { kind: "timesheets", title: "Bảng công nhân sự", endpoint: "/v1/timesheets", description: "Rà soát giờ công nguồn, ngoại lệ và trạng thái trước khi đưa vào kỳ bảng lương.", empty: "Chưa có bảng công trong phạm vi được cấp quyền." },
  "/admin/timesheet-periods": { kind: "periods", title: "Kỳ bảng công", endpoint: "/v1/timesheet-periods", description: "Theo dõi các mốc gửi duyệt, rà soát, khóa và đóng kỳ do máy chủ quản lý.", empty: "Chưa có kỳ bảng công trong phạm vi được cấp quyền." },
};

export default function AttendanceWorkspace({ pathname }: { pathname: string }) {
  const detail = pathname.match(/^\/admin\/timesheets\/([^/]+)$/);
  if (detail) return <TimesheetDetail timesheetId={detail[1] ?? ""} />;
  return <AttendanceDirectory config={attendanceConfig[pathname] ?? attendanceConfig["/admin/time-clock"]!} />;
}

function hours(seconds: unknown) {
  const value = Number(seconds ?? 0);
  if (!Number.isFinite(value)) return "—";
  return `${(value / 3600).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} giờ`;
}

function TimesheetDetail({ timesheetId }: { timesheetId: string }) {
  const resource = useResource(`/v1/timesheets/${timesheetId}`);
  const adjustments = useResource(`/v1/timesheets/${timesheetId}/adjustments`);
  const mutation = useMutation(resource.reload);
  const row = resource.rows[0] ?? {};
  const state = String(row.state ?? "").toUpperCase();
  const actionMap: Record<string, Array<[string, string, boolean?]>> = {
    DRAFT: [["submit", "Gửi duyệt"]],
    SUBMITTED: [["approve", "Phê duyệt"], ["reject", "Từ chối", true]],
    APPROVED: [["lock", "Khóa bảng công"], ["reopen", "Mở lại"]],
    REOPENED: [["submit", "Gửi duyệt"]],
  };
  const actions = actionMap[state] ?? [];
  const run = (action: string) => mutation.run(`/v1/timesheets/${timesheetId}/${action}`, { version: row.version });
  return <Page eyebrow="Attendance" title="Timesheet detail" description="Bằng chứng giờ công, trạng thái phê duyệt và lịch sử điều chỉnh của bản ghi nguồn.">
    <div className="s19-w4-detail-grid">
      <section className="s19-card">
        <div className="s19-w4-toolbar"><span className="s19-w4-live-indicator">● Dữ liệu máy chủ trực tiếp</span><a className="s19-button s19-button-secondary" href="/admin/timesheets">Quay lại danh sách</a></div>
        <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có bảng công trong phạm vi được cấp quyền." />
        {resource.state === "ready" && <>
          <div className="s19-w4-detail-hero"><div><p className="s19-eyebrow">Bảng công nguồn</p><h2>{wave4Text(state || "PENDING")}</h2><p>Phiên bản {format(row.version, "version")} · dấu vân tay nguồn được máy chủ quản lý.</p></div><span className={`s19-status s19-status-${state.toLowerCase()}`}>{wave4Text(state)}</span></div>
          <dl className="s19-w4-dl">{[
            ["Regular hours", hours(row.regularSeconds)], ["Overtime hours", hours(row.overtimeSeconds)], ["Payable hours", hours(row.payableSeconds)],
            ["Scheduled hours", hours(row.scheduledSeconds)], ["Paid break", hours(row.paidBreakSeconds)], ["Unpaid break", hours(row.unpaidBreakSeconds)],
            ["Exceptions", row.exceptionCount], ["Adjustments", row.adjustmentCount], ["Version", row.version],
          ].map(([label, value]) => <div key={String(label)}><dt>{wave4Text(String(label))}</dt><dd>{String(value ?? "—")}</dd></div>)}</dl>
          <div className="s19-w4-evidence"><h3>{wave4Text("Timesheet source")}</h3><p>{row.sourceLockedAt ? "Bản ghi đã được khóa làm nguồn cho kỳ bảng lương." : state === "LOCKED" ? "Trạng thái bảng công đã khóa; chưa ghi nhận liên kết nguồn tới kỳ bảng lương." : "Bản ghi chưa bị khóa làm nguồn cho kỳ bảng lương."}</p><dl className="s19-w4-inline-dl"><div><dt>Gửi duyệt</dt><dd>{format(row.submittedAt, "submittedAt")}</dd></div><div><dt>Phê duyệt</dt><dd>{format(row.approvedAt, "approvedAt")}</dd></div><div><dt>Khóa nguồn</dt><dd>{format(row.sourceLockedAt, "lockedAt")}</dd></div></dl></div>
          {actions.length > 0 && <div className="s19-w4-action-set">{actions.map(([action, label, danger]) => <button type="button" key={action} className={`s19-button ${danger ? "s19-button-danger" : "s19-button-primary"}`} disabled={mutation.busy} onClick={() => run(action)}>{wave4Text(label)}</button>)}</div>}
          {mutation.notice && <p className="s19-notice s19-notice-success" role="status">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger" role="alert">{mutation.error}</p>}
        </>}
      </section>
      <section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">Audit</p><h2>{wave4Text("Adjustments")}</h2></div><span className="s19-chip">{adjustments.rows.length}</span></div><StatePanel state={adjustments.state} error={adjustments.error} retry={adjustments.reload} empty="No adjustment requests." />{adjustments.state === "ready" && <Table rows={adjustments.rows} columns={[["status", "Trạng thái"], ["requestedAmountMinor", "Số tiền"], ["createdAt", "Thời điểm"], ["version", "Phiên bản"]]} />}</section>
    </div>
  </Page>;
}
function AttendanceDirectory({ config }: { config: AttendanceConfig }) {
  const resource = useResource(config.endpoint);
  const mutation = useMutation(resource.reload);
  const rows = resource.rows as AttendanceRow[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => recordId(row) === selectedId) ?? rows[0];
  const stats = attendanceStats(config.kind, rows);
  return <Page eyebrow="Chấm công" title={config.title} description={config.description}>
    <section className="s19-w4-attendance-kpis" aria-label="Tổng quan chấm công">
      {stats.map(([label, value, helper], index) => <article className={index === 1 ? "is-accent" : ""} key={label}><span>{label}</span><strong>{value}</strong><p>{helper ?? "Theo dữ liệu máy chủ trong phạm vi được cấp quyền."}</p></article>)}
    </section>
    <section className="s19-card s19-w4-attendance-card">
      <div className="s19-w4-toolbar"><div><span className="s19-payout-section-kicker">BẰNG CHỨNG NGHIỆP VỤ</span><h2 className="s19-payout-section-title">{config.title}</h2><p className="s19-helper">Chỉ hiển thị dữ liệu trong phạm vi tenant và chi nhánh mà máy chủ cấp quyền.</p></div><div className="s19-page-heading-actions"><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.reload()}>Làm mới</button></div></div>
      <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty={config.empty} />
      {resource.state === "ready" ? <div className="s19-w4-attendance-table-wrap"><table className="s19-w4-attendance-table"><caption className="sr-only">{config.title}</caption><thead><AttendanceHead kind={config.kind} /></thead><tbody>{rows.map((row) => { const id = recordId(row); const isSelected = id === (selected ? recordId(selected) : null); return <tr key={id} aria-selected={isSelected} className={isSelected ? "is-selected" : ""} onClick={() => setSelectedId(id)}><AttendanceCells kind={config.kind} row={row} /><td data-label="Thao tác"><AttendanceActions kind={config.kind} row={row} endpoint={config.endpoint} mutation={mutation} /></td></tr>; })}</tbody></table></div> : null}
      {mutation.notice ? <p className="s19-notice s19-notice-success" role="status">{mutation.notice}</p> : null}{mutation.error ? <p className="s19-notice s19-notice-danger" role="alert">{mutation.error}</p> : null}
    </section>
    <section className="s19-w4-attendance-inspector s19-card" aria-label="Chi tiết bản ghi">
      {selected ? <><div className="s19-card-heading"><div><span className="s19-payout-section-kicker">BẢN GHI ĐANG CHỌN</span><h2>{recordTitle(config.kind, selected)}</h2></div><span className="s19-chip">{stateLabel(selected.state ?? selected.status)}</span></div><dl className="s19-w4-dl">{inspectorFacts(config.kind, selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="s19-helper">Mã bản ghi, phiên bản và thời điểm đều lấy từ response máy chủ; trình duyệt không tự suy diễn trạng thái.</p></> : <div className="s19-state is-compact"><div><h2>Chọn một bản ghi</h2><p>Thông tin chi tiết sẽ xuất hiện ở đây.</p></div></div>}
    </section>
  </Page>;
}

function recordId(row: AttendanceRow) { return String(row.id ?? ""); }
function value(row: AttendanceRow, ...keys: string[]) { for (const key of keys) if (row[key] !== null && row[key] !== undefined && row[key] !== "") return row[key]; return null; }
function shortId(input: unknown) { const id = String(input ?? ""); return id ? `#${id.slice(0, 8)}` : "—"; }
const attendanceLabels: Record<string, string> = {
  UNKNOWN: "Chưa xác định", KIOSK: "Kiosk", TABLET: "Máy tính bảng", WEB: "Trình duyệt",
  EXCESSIVE_SESSION_DURATION: "Phiên làm việc vượt ngưỡng", MISSED_CLOCK_OUT: "Thiếu lượt kết ca",
  BLOCKING: "Bắt buộc xử lý", WARNING: "Cảnh báo", REVOKED: "Đã thu hồi",
};
function stateLabel(input: unknown) { const key = String(input ?? "").toUpperCase(); return (attendanceLabels[key] ?? wave4Text(key || "UNKNOWN")) || "Chưa xác định"; }
function stateTone(input: unknown) { const state = String(input ?? "").toUpperCase(); if (["OPEN", "PRESENT", "ACTIVE", "APPROVED", "LOCKED", "CLOSED", "RESOLVED", "WAIVED"].includes(state)) return "is-good"; if (["ON_BREAK", "LATE", "ACKNOWLEDGED", "SUBMITTED", "REVIEW", "SUBMISSION_OPEN"].includes(state)) return "is-warning"; if (["MISSED", "ABSENT", "FAILED", "REJECTED"].includes(state)) return "is-danger"; return "is-neutral"; }
function recordTitle(kind: AttendanceKind, row: AttendanceRow) { if (kind === "devices") return String(value(row, "name", "deviceType") ?? "Thiết bị chấm công"); if (kind === "periods") return String(value(row, "code") ?? "Kỳ bảng công"); if (kind === "exceptions") return stateLabel(value(row, "exceptionType") ?? "Ngoại lệ chấm công"); if (kind === "timesheets") return "Bảng công"; return "Phiên chấm công"; }
function attendanceStats(kind: AttendanceKind, rows: AttendanceRow[]): Array<[string, string, string?]> {
  const states = rows.map((row) => String(row.state ?? row.status ?? "").toUpperCase());
  if (kind === "devices") return [["Thiết bị trong phạm vi", String(rows.length)], ["Đang hoạt động", String(states.filter((state) => state === "ACTIVE").length)], ["Đã thu hồi", String(states.filter((state) => state === "REVOKED").length)]];
  if (kind === "exceptions") return [["Tổng ngoại lệ", String(rows.length)], ["Đang cần xử lý", String(states.filter((state) => ["OPEN", "ACKNOWLEDGED"].includes(state)).length)], ["Bắt buộc xử lý", String(rows.filter((row) => String(row.severity ?? "").toUpperCase() === "BLOCKING" && !["RESOLVED", "WAIVED"].includes(String(row.state ?? "").toUpperCase())).length)]];
  if (kind === "periods") return [["Kỳ trong phạm vi", String(rows.length)], ["Đang mở", String(states.filter((state) => ["OPEN", "SUBMISSION_OPEN", "REVIEW"].includes(state)).length)], ["Đã đóng", String(states.filter((state) => state === "CLOSED").length)]];
  if (kind === "timesheets") return [["Bảng công trong phạm vi", String(rows.length)], ["Chờ phê duyệt", String(states.filter((state) => ["SUBMITTED", "PENDING_APPROVAL"].includes(state)).length)], ["Đã khóa", String(states.filter((state) => state === "LOCKED").length)]];
  return [[kind === "live" ? "Phiên đang hiển thị" : "Tổng phiên", String(rows.length)], ["Đang mở", String(states.filter((state) => ["OPEN", "PRESENT"].includes(state)).length)], ["Đã kết thúc", String(states.filter((state) => ["CLOSED", "COMPLETED"].includes(state)).length)]];
}
function AttendanceHead({ kind }: { kind: AttendanceKind }) {
  const labels: Record<AttendanceKind, string[]> = { live: ["Nhân sự", "Bắt đầu", "Đang nghỉ", "Trạng thái", "Chi nhánh"], sessions: ["Nhân sự", "Bắt đầu", "Kết thúc", "Giờ được tính", "Trạng thái"], exceptions: ["Ngoại lệ", "Nhân sự", "Mức độ", "Trạng thái", "Phát hiện"], devices: ["Thiết bị", "Loại thiết bị", "Chi nhánh", "Trạng thái", "Cập nhật"], timesheets: ["Bảng công", "Nhân sự", "Giờ thường", "Giờ làm thêm", "Trạng thái"], periods: ["Kỳ bảng công", "Khoảng thời gian", "Múi giờ", "Trạng thái", "Cập nhật"] };
  return <tr>{labels[kind].map((label) => <th scope="col" key={label}>{label}</th>)}<th scope="col">Thao tác</th></tr>;
}
function AttendanceCells({ kind, row }: { kind: AttendanceKind; row: AttendanceRow }) {
  const status = row.state ?? row.status;
  const statusCell = <span className={`s19-w4-attendance-status ${stateTone(status)}`}>{stateLabel(status)}</span>;
  if (kind === "live") return <><td data-label="Nhân sự"><strong>{shortId(row.staffId)}</strong><small>Nhân sự nguồn</small></td><td data-label="Bắt đầu">{format(value(row, "startedAt", "startAt"), "startedAt")}</td><td data-label="Đang nghỉ">{value(row, "openBreakId") ? "Có" : "Không"}</td><td data-label="Trạng thái">{statusCell}</td><td data-label="Chi nhánh">{shortId(row.branchId)}</td></>;
  if (kind === "sessions") return <><td data-label="Nhân sự"><strong>{shortId(row.staffId)}</strong><small>Phiên {shortId(row.id)}</small></td><td data-label="Bắt đầu">{format(value(row, "startedAt", "startAt"), "startedAt")}</td><td data-label="Kết thúc">{format(value(row, "endedAt", "endAt"), "endedAt")}</td><td data-label="Giờ được tính">{hours(value(row, "payableSeconds"))}</td><td data-label="Trạng thái">{statusCell}</td></>;
  if (kind === "exceptions") return <><td data-label="Ngoại lệ"><strong>{wave4Text(String(row.exceptionType ?? "Ngoại lệ chấm công"))}</strong><small>{shortId(row.id)}</small></td><td data-label="Nhân sự">{shortId(row.staffId)}</td><td data-label="Mức độ">{stateLabel(row.severity)}</td><td data-label="Trạng thái">{statusCell}</td><td data-label="Phát hiện">{format(row.createdAt, "createdAt")}</td></>;
  if (kind === "devices") return <><td data-label="Thiết bị"><strong>{String(value(row, "name") ?? "Thiết bị không tên")}</strong><small>{shortId(row.id)}</small></td><td data-label="Loại thiết bị">{stateLabel(row.deviceType)}</td><td data-label="Chi nhánh">{shortId(row.branchId)}</td><td data-label="Trạng thái">{statusCell}</td><td data-label="Cập nhật">{format(value(row, "updatedAt", "createdAt", "lastSeenAt"), "updatedAt")}</td></>;
  if (kind === "timesheets") return <><td data-label="Bảng công"><strong>{shortId(row.id)}</strong><small>Kỳ {shortId(value(row, "periodId", "timesheetPeriodId"))}</small></td><td data-label="Nhân sự">{shortId(row.staffId)}</td><td data-label="Giờ thường">{hours(value(row, "regularSeconds"))}</td><td data-label="Giờ làm thêm">{hours(value(row, "overtimeSeconds"))}</td><td data-label="Trạng thái">{statusCell}</td></>;
  return <><td data-label="Kỳ bảng công"><strong>{String(value(row, "code") ?? shortId(row.id))}</strong><small>{shortId(row.id)}</small></td><td data-label="Khoảng thời gian">{format(value(row, "startsOn", "startDate"), "startsOn")} → {format(value(row, "endsOn", "endDate"), "endsOn")}</td><td data-label="Múi giờ">{String(value(row, "timezone") ?? "—")}</td><td data-label="Trạng thái">{statusCell}</td><td data-label="Cập nhật">{format(value(row, "updatedAt", "createdAt"), "updatedAt")}</td></>;
}
function AttendanceActions({ kind, row, endpoint, mutation }: { kind: AttendanceKind; row: AttendanceRow; endpoint: string; mutation: ReturnType<typeof useMutation> }) {
  const id = recordId(row); const state = String(row.state ?? row.status ?? "").toUpperCase();
  if (kind === "exceptions") return <ExceptionActions row={row} mutation={mutation} />;
  if (kind === "devices") return state === "REVOKED" ? <span className="s19-w4-attendance-muted">Không có thao tác</span> : <button className="s19-button s19-button-danger" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`${endpoint}/${id}/revoke`, { version: row.version })}>Thu hồi</button>;
  const actions: Record<AttendanceKind, Record<string, Array<[string, string, boolean?]>>> = {
    live: {}, sessions: {}, exceptions: {}, devices: {},
    timesheets: { DRAFT: [["submit", "Gửi duyệt"]], SUBMITTED: [["approve", "Phê duyệt"], ["reject", "Từ chối", true]], APPROVED: [["lock", "Khóa bảng công"], ["reopen", "Mở lại"]], REOPENED: [["submit", "Gửi duyệt"]] },
    periods: { OPEN: [["open-submission", "Mở gửi duyệt"]], SUBMISSION_OPEN: [["start-review", "Bắt đầu rà soát"]], REVIEW: [["lock", "Khóa kỳ"]], LOCKED: [["close", "Đóng kỳ"]] },
  };
  const available = actions[kind][state] ?? [];
  if (!available.length) return <span className="s19-w4-attendance-muted">Không có thao tác</span>;
  return <div className="s19-w4-attendance-actions">{available.map(([action, label, danger]) => <button key={action} className={`s19-button ${danger ? "s19-button-danger" : "s19-button-secondary"}`} type="button" disabled={mutation.busy} onClick={() => void mutation.run(`${endpoint}/${id}/${action}`, { version: row.version })}>{label}</button>)}</div>;
}
function ExceptionActions({ row, mutation }: { row: AttendanceRow; mutation: ReturnType<typeof useMutation> }) {
  const [showReason, setShowReason] = useState(false); const [reason, setReason] = useState(""); const id = recordId(row); const state = String(row.state ?? "").toUpperCase();
  if (state === "OPEN") return <button className="s19-button s19-button-secondary" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/v1/time-clock/exceptions/${id}/acknowledge`, { version: row.version })}>Xác nhận</button>;
  if (state !== "ACKNOWLEDGED") return <span className="s19-w4-attendance-muted">Không có thao tác</span>;
  return <div className="s19-w4-attendance-actions"><button className="s19-button s19-button-secondary" type="button" disabled={mutation.busy} onClick={() => setShowReason((current) => !current)}>{showReason ? "Đóng" : "Xử lý"}</button>{showReason ? <form className="s19-w4-attendance-reason" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void mutation.run(`/v1/time-clock/exceptions/${id}/resolve`, { version: row.version, reason: reason.trim() }); }}><label><span>Lý do xử lý</span><input required value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="s19-button s19-button-secondary" type="submit" disabled={mutation.busy || !reason.trim()}>Đánh dấu đã xử lý</button><button className="s19-button s19-button-ghost" type="button" disabled={mutation.busy || !reason.trim()} onClick={() => void mutation.run(`/v1/time-clock/exceptions/${id}/waive`, { version: row.version, reason: reason.trim() })}>Miễn trừ</button></form> : null}</div>;
}
function inspectorFacts(kind: AttendanceKind, row: AttendanceRow): Array<[string, string]> {
  const facts: Array<[string, unknown]> = kind === "devices" ? [["Mã thiết bị", shortId(row.id)], ["Chi nhánh", shortId(row.branchId)], ["Loại", stateLabel(row.deviceType)], ["Trạng thái", stateLabel(row.status)], ["Phiên bản", row.version]] : kind === "exceptions" ? [["Mã ngoại lệ", shortId(row.id)], ["Nhân sự", shortId(row.staffId)], ["Phiên chấm công", shortId(row.sessionId)], ["Mức độ", stateLabel(row.severity)], ["Lý do xử lý", row.resolutionReason]] : kind === "periods" ? [["Mã kỳ", value(row, "code")], ["Bắt đầu", value(row, "startsOn", "startDate")], ["Kết thúc", value(row, "endsOn", "endDate")], ["Múi giờ", row.timezone], ["Phiên bản", row.version]] : kind === "timesheets" ? [["Mã bảng công", shortId(row.id)], ["Nhân sự", shortId(row.staffId)], ["Giờ thường", hours(row.regularSeconds)], ["Giờ làm thêm", hours(row.overtimeSeconds)], ["Giờ được tính", hours(row.payableSeconds)], ["Phiên bản", row.version]] : [["Mã bản ghi", shortId(row.id)], ["Nhân sự", shortId(row.staffId)], ["Chi nhánh", shortId(row.branchId)], ["Bắt đầu", format(value(row, "startedAt", "startAt"), "startedAt")], ["Kết thúc", format(value(row, "endedAt", "endAt"), "endedAt")], ["Phiên bản", row.version]];
  return facts.map(([label, raw]) => [label, String(raw ?? "—")]);
}
