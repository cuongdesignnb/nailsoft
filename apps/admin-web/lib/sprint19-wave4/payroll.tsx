"use client";
import { ActionButton, Page, StatePanel, Table, format, useMutation, useResource, wave4Text } from "./shared";

export default function PayrollWorkspace({ pathname }: { pathname: string }) {
  const detail = pathname.match(/^\/admin\/(payroll\/runs|payouts)\/([^/]+)$/);
  const configs: Record<string, [string, string, string]> = {
    "/admin/payroll/calendars": ["Payroll calendars", "/v1/payroll-calendars", "Timezone-aware configurable payroll frequency."],
    "/admin/payroll/periods": ["Payroll periods", "/v1/payroll/periods", "Periods generated from locked timesheet windows."],
    "/admin/payroll/runs": ["Payroll runs", "/v1/payroll/runs", "Deterministic sources, independent approval and immutable finalization."],
    "/admin/payroll/exceptions": ["Payroll exceptions", "/v1/payroll/exceptions", "Blocking source, policy, currency and payout readiness issues."],
    "/admin/payroll/statements": ["Pay statements", "/v1/pay-statements", "Private immutable finalized statements."],
    "/admin/payroll/reports": ["Payroll reports", "/v1/payroll/reports/summary", "Earnings, commission, tips and source reconciliation."],
    "/admin/payouts": ["Payout batches", "/v1/payout-batches", "Evidence-led payout processing with dual control."],
    "/admin/payout-reconciliation": ["Payout reconciliation", "/v1/payout-reconciliations", "Expected, confirmed, reversed and variance evidence."],
  };
  const key = detail ? `/${detail[1]}`.replace("/payroll/runs", "/admin/payroll/runs").replace("/payouts", "/admin/payouts") : pathname; const cfg = configs[key] ?? configs["/admin/payroll/runs"]!;
  if (key === "/admin/payouts") return <PayoutWorkspace endpoint={detail ? `${cfg[1]}/${detail[2]}` : cfg[1]} detail={Boolean(detail)} />;
  return <PayrollTable title={cfg[0]} endpoint={detail ? `${cfg[1]}/${detail[2]}` : cfg[1]} description={cfg[2]} kind={key.includes("payout") ? "payout" : key.includes("run") ? "run" : "standard"} />;
}

type PayoutRow = Record<string, unknown>;

const payoutStates: Record<string, string> = {
  DRAFT: "Bản nháp",
  PENDING_APPROVAL: "Chờ phê duyệt",
  APPROVED: "Đã phê duyệt",
  PROCESSING: "Đang xử lý",
  PARTIALLY_PAID: "Đã chi một phần",
  PAID: "Đã chi trả",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  REVERSAL_PENDING: "Chờ đảo chi",
  REVERSED: "Đã đảo chi",
};

const payoutMethods: Record<string, string> = {
  BANK_TRANSFER: "Chuyển khoản",
  CASH: "Tiền mặt",
  MANUAL_OTHER: "Phương thức khác",
};

function payoutStateLabel(value: unknown) {
  const key = String(value ?? "").toUpperCase();
  return payoutStates[key] ?? wave4Text(key) ?? "Cần kiểm tra";
}

function payoutMethodLabel(value: unknown) {
  const key = String(value ?? "").toUpperCase();
  return payoutMethods[key] ?? (key ? wave4Text(key) : "Chưa xác định");
}

function payoutMoney(value: unknown, currency: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const code = String(currency ?? "VND");
  const normalizedAmount = code === "VND" ? amount : amount / 100;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: code, maximumFractionDigits: code === "VND" ? 0 : 2 }).format(normalizedAmount);
}

function shortSystemId(value: unknown) {
  const id = String(value ?? "");
  return id ? `#${id.slice(0, 8)}` : "—";
}

function payoutText(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function payoutActions(state: unknown) {
  const value = String(state ?? "").toUpperCase();
  if (value === "DRAFT") return [{ key: "submit", label: "Gửi duyệt", danger: false }];
  if (value === "PENDING_APPROVAL") return [{ key: "approve", label: "Phê duyệt", danger: false }];
  if (value === "APPROVED") return [{ key: "process", label: "Bắt đầu xử lý", danger: false }];
  if (value === "FAILED") return [{ key: "retry-failed", label: "Thử xử lý lại", danger: false }];
  return [];
}

function PayoutWorkspace({ endpoint, detail }: { endpoint: string; detail: boolean }) {
  return detail ? <PayoutDetail endpoint={endpoint} /> : <PayoutDirectory endpoint={endpoint} />;
}

function PayoutDirectory({ endpoint }: { endpoint: string }) {
  const resource = useResource(endpoint);
  const mutation = useMutation(resource.reload);
  const rows = resource.rows as unknown as PayoutRow[];
  const stateCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const state = String(row.state ?? "UNKNOWN").toUpperCase();
    counts[state] = (counts[state] ?? 0) + 1;
    return counts;
  }, {});
  return <Page eyebrow="Chi trả" title="Đợt chi trả" description="Theo dõi số tiền phải chi, trạng thái xử lý và kiểm soát kép theo dữ liệu bảng lương đã chốt.">
    <section className="s19-payout-overview" aria-label="Tổng quan chi trả">
      <article className="s19-payout-hero-card"><span className="s19-payout-kicker">ĐỢT TRONG PHẠM VI</span><strong>{rows.length}</strong><p>Danh sách do máy chủ trả về trong phạm vi được cấp quyền.</p></article>
      <article className="s19-payout-hero-card s19-payout-hero-card-accent"><span className="s19-payout-kicker">ĐANG CHỜ DUYỆT</span><strong>{stateCounts.PENDING_APPROVAL ?? 0}</strong><p>Người tạo không được tự phê duyệt đợt chi trả.</p></article>
      <article className="s19-payout-hero-card"><span className="s19-payout-kicker">Đã chi trả</span><strong>{stateCounts.PAID ?? 0}</strong><p>Chỉ chuyển trạng thái sau khi máy chủ xác nhận.</p></article>
    </section>
    <section className="s19-card">
      <div className="s19-w4-toolbar"><div><span className="s19-payout-section-kicker">DANH SÁCH NGHIỆP VỤ</span><h2 className="s19-payout-section-title">Các đợt chi trả</h2><p className="s19-helper">Mỗi đợt liên kết với một kỳ bảng lương đã chốt và giữ nguyên bằng chứng xử lý.</p></div><div className="s19-page-heading-actions"><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span><a className="s19-button s19-button-secondary" href="/admin/payroll/runs">Xem kỳ bảng lương</a><button className="s19-button s19-button-secondary" type="button" onClick={() => void resource.reload()}>Làm mới</button></div></div>
      <StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có đợt chi trả trong phạm vi được cấp quyền." />
      {resource.state === "ready" ? <div className="s19-payout-table-wrap" tabIndex={0} role="region" aria-label="Bảng dữ liệu các đợt chi trả"><table className="s19-payout-table"><thead><tr><th scope="col">Đợt chi trả</th><th scope="col">Kỳ bảng lương</th><th scope="col">Hình thức</th><th scope="col">Nhân sự</th><th scope="col">Tổng tiền</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id ?? "row")}><td data-label="Đợt chi trả"><a className="s19-payout-record-link" href={`/admin/payouts/${String(row.id ?? "")}`}>{shortSystemId(row.id)}</a><small>{format(row.createdAt, "createdAt")}</small></td><td data-label="Kỳ bảng lương"><a className="s19-payout-muted-link" href={row.payrollRunId ? `/admin/payroll/runs/${String(row.payrollRunId)}` : "/admin/payroll/runs"}>{shortSystemId(row.payrollRunId)}</a></td><td data-label="Hình thức">{payoutMethodLabel(row.method)}</td><td data-label="Nhân sự">{Number.isFinite(Number(row.itemCount)) ? Number(row.itemCount).toLocaleString("vi-VN") : "—"}</td><td data-label="Tổng tiền" className="s19-payout-money">{payoutMoney(row.totalMinor, row.currency)}</td><td data-label="Trạng thái"><span className={`s19-payout-status s19-payout-status-${String(row.state ?? "unknown").toLowerCase()}`}>{payoutStateLabel(row.state)}</span></td><td data-label="Thao tác"><div className="s19-payout-actions"><a className="s19-button s19-button-secondary" href={`/admin/payouts/${String(row.id ?? "")}`}>Mở chi tiết</a>{payoutActions(row.state).map((action) => <button key={action.key} className={`s19-button ${action.danger ? "s19-button-danger" : "s19-button-secondary"}`} type="button" disabled={mutation.busy} onClick={() => void mutation.run(`${endpoint}/${String(row.id ?? "")}/${action.key}`, { version: row.version })}>{action.label}</button>)}</div></td></tr>)}</tbody></table></div> : null}
      {mutation.notice ? <p className="s19-notice s19-notice-success" role="status">{mutation.notice}</p> : null}{mutation.error ? <p className="s19-notice s19-notice-danger" role="alert">{mutation.error}</p> : null}
    </section>
  </Page>;
}

function PayoutDetail({ endpoint }: { endpoint: string }) {
  const batch = useResource(endpoint);
  const row = batch.rows[0] as unknown as PayoutRow | undefined;
  return <Page eyebrow="Chi trả" title="Chi tiết đợt chi trả" description="Bằng chứng của đợt chi trả được đọc trực tiếp từ máy chủ; mọi thay đổi đều qua transition có kiểm soát.">
    <div className="s19-payout-detail-actions"><a className="s19-button s19-button-secondary" href="/admin/payouts">← Quay lại danh sách</a>{row?.payrollRunId ? <a className="s19-button s19-button-secondary" href={`/admin/payroll/runs/${row.payrollRunId}`}>Mở kỳ bảng lương</a> : null}</div>
    <StatePanel state={batch.state} error={batch.error} retry={batch.reload} empty="Không tìm thấy đợt chi trả này trong phạm vi được cấp quyền." />
    {batch.state === "ready" && row ? <PayoutDetailContent batch={batch} row={row} /> : null}
  </Page>;
}

function PayoutDetailContent({ batch, row }: { batch: ReturnType<typeof useResource>; row: PayoutRow }) {
  const items = useResource(`/v1/payout-batches/${String(row.id ?? "")}/items`);
  const mutation = useMutation(async () => { await batch.reload(); await items.reload(); });
  const actions = payoutActions(row.state);
  const itemRows = items.rows as unknown as PayoutRow[];
  return <>
     <section className="s19-payout-detail-hero"><div><span className="s19-payout-section-kicker">ĐỢT ĐANG XEM</span><h2>{shortSystemId(row.id)}</h2><p>Kỳ bảng lương {shortSystemId(row.payrollRunId)} · Phiên bản {payoutText(row.version)}</p></div><div className="s19-payout-detail-total"><small>Tổng tiền</small><strong>{payoutMoney(row.totalMinor, row.currency)}</strong><span className={`s19-payout-status s19-payout-status-${String(row.state ?? "unknown").toLowerCase()}`}>{payoutStateLabel(row.state)}</span></div></section>
     <section className="s19-payout-fact-grid" aria-label="Thông tin đợt chi trả"><article><span>Hình thức</span><strong>{payoutMethodLabel(row.method)}</strong></article><article><span>Tiền tệ</span><strong>{payoutText(row.currency)}</strong></article><article><span>Số nhân sự</span><strong>{payoutText(row.itemCount)}</strong></article><article><span>Nhà cung cấp</span><strong>{payoutText(row.providerCode, "Chưa cấu hình")}</strong></article><article><span>Người yêu cầu</span><strong>{shortSystemId(row.requestedByUserId)}</strong></article><article><span>Cập nhật gần nhất</span><strong>{format(row.updatedAt ?? row.createdAt, "updatedAt")}</strong></article></section>
     <section className="s19-payout-detail-grid"><article className="s19-card"><div className="s19-card-heading"><div><span className="s19-payout-section-kicker">LUỒNG XỬ LÝ</span><h2>Trạng thái và thao tác</h2></div></div><p className="s19-helper">Màn hình chỉ hiển thị transition hợp lệ theo trạng thái hiện tại. Backend vẫn kiểm tra quyền, phiên bản và kiểm soát kép.</p><div className="s19-payout-state-rail" tabIndex={0} role="region" aria-label="Tiến trình trạng thái chi trả">{["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID"].map((state) => <span className={String(row.state).toUpperCase() === state ? "is-current" : ""} key={state}>{payoutStateLabel(state)}</span>)}</div><div className="s19-payout-actions">{actions.length ? actions.map((action) => <button key={action.key} className={`s19-button ${action.danger ? "s19-button-danger" : "s19-button-secondary"}`} type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/v1/payout-batches/${row.id}/${action.key}`, { version: row.version })}>{action.label}</button>) : <span className="s19-payout-muted">Không có transition thao tác ở trạng thái này.</span>}</div>{mutation.notice ? <p className="s19-notice s19-notice-success" role="status">{mutation.notice}</p> : null}{mutation.error ? <p className="s19-notice s19-notice-danger" role="alert">{mutation.error}</p> : null}</article><article className="s19-card"><div className="s19-card-heading"><div><span className="s19-payout-section-kicker">AN TOÀN TÀI CHÍNH</span><h2>Nguyên tắc chi trả</h2></div></div><ul className="s19-payout-safety-list"><li>Chỉ dùng phiếu lương chưa thanh toán từ kỳ đã chốt.</li><li>Người tạo không thể tự phê duyệt.</li><li>Không hiển thị thành công trước khi máy chủ xác nhận.</li></ul></article></section>
     <section className="s19-card"><div className="s19-card-heading"><div><span className="s19-payout-section-kicker">CHI TIẾT PHÂN BỔ</span><h2>Các khoản chi trong đợt</h2><p className="s19-helper">Dữ liệu item được trả riêng bởi API và không làm lộ thông tin tài khoản thanh toán.</p></div></div><StatePanel state={items.state} error={items.error} retry={items.reload} empty="Chưa có khoản chi trong đợt này." />{items.state === "ready" ? <div className="s19-payout-table-wrap" tabIndex={0} role="region" aria-label="Bảng phân bổ các khoản chi"><table className="s19-payout-table"><thead><tr><th scope="col">Khoản chi</th><th scope="col">Nhân sự</th><th scope="col">Yêu cầu</th><th scope="col">Xác nhận</th><th scope="col">Trạng thái</th><th scope="col">Nhà cung cấp</th></tr></thead><tbody>{itemRows.map((item) => <tr key={String(item.id ?? "item")}><td data-label="Khoản chi"><span className="s19-payout-record-link">{shortSystemId(item.id)}</span><small>Phiếu lương {shortSystemId(item.payStatementId)}</small></td><td data-label="Nhân sự">{shortSystemId(item.staffId)}</td><td data-label="Yêu cầu" className="s19-payout-money">{payoutMoney(item.requestedMinor, item.currency ?? row.currency)}</td><td data-label="Xác nhận" className="s19-payout-money">{payoutMoney(item.confirmedMinor, item.currency ?? row.currency)}</td><td data-label="Trạng thái"><span className={`s19-payout-status s19-payout-status-${String(item.state ?? "unknown").toLowerCase()}`}>{payoutStateLabel(item.state)}</span></td><td data-label="Nhà cung cấp">{payoutText(item.providerReference)}</td></tr>)}</tbody></table></div> : null}</section>
  </>;
}

function PayrollTable({ title, endpoint, description, kind }: { title: string; endpoint: string; description: string; kind: "payout" | "run" | "standard" }) {
  const resource = useResource(endpoint); const mutation = useMutation(resource.reload); const rows = resource.rows;
  const columns = rows.length ? Object.keys(rows[0] ?? {}).filter((key) => !key.toLowerCase().includes("json")).slice(0, 8).map((key) => [key, key.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())] as [string, string]) : [["id", "ID"], ["status", "Status"]] as [string, string][];
  const actions = kind === "run" ? ["calculate", "submit", "approve", "finalize"] : kind === "payout" ? ["submit", "approve", "process", "cancel"] : [];
  return <Page eyebrow={kind === "payout" ? "Payout" : "Payroll"} title={title} description={description}><section className="s19-card"><div className="s19-w4-toolbar"><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span><button className="s19-button s19-button-secondary" onClick={resource.reload}>{wave4Text("Refresh")}</button></div><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có bản ghi trong phạm vi được cấp quyền." />{resource.state === "ready" && <Table rows={rows} columns={columns} />}{actions.length > 0 && resource.state === "ready" && <div className="s19-inline-actions">{rows.slice(0, 5).flatMap((row) => actions.map((action) => <ActionButton key={`${row.id}-${action}`} label={`${action} ${String(row.id ?? "").slice(0, 6)}`} onClick={() => mutation.run(`${endpoint}/${row.id}/${action}`, { version: row.version })} danger={action === "cancel"} />))}</div>}{mutation.notice && <p className="s19-notice s19-notice-success">{mutation.notice}</p>}{mutation.error && <p className="s19-notice s19-notice-danger">{mutation.error}</p>}</section></Page>;
}
