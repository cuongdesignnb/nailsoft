/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { api, ActionButton, Field, format, Page, StatePanel, Table, useMutation, useResource } from "./shared";

export default function StaffWorkspace({ pathname }: { pathname: string }) {
  const id = pathname.match(/^\/admin\/staff\/([^/]+)$/)?.[1];
  if (pathname === "/admin/staff/new") return <StaffForm />;
  if (id && id !== "list") return <StaffDetail id={id} />;
  return <StaffDirectory />;
}

function StaffDirectory() {
  const resource = useResource("/v1/staff");
  const [query, setQuery] = useState("");
  const rows = resource.rows.filter((row) => !query || `${row.displayName} ${row.employeeCode}`.toLowerCase().includes(query.toLowerCase()));
  return <Page eyebrow="NHÂN SỰ" title="Danh sách nhân sự" description="Tìm hồ sơ theo trạng thái làm việc và phạm vi chi nhánh." actions={<a className="s19-button s19-button-primary" href="/admin/staff/new">Thêm nhân sự</a>}>
    <section className="s19-card"><div className="s19-w4-toolbar"><label className="s19-field"><span>Tìm nhân sự</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc mã nhân sự" /></label><button className="s19-button s19-button-secondary" onClick={resource.reload}>Làm mới</button></div><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="Chưa có hồ sơ nhân sự phù hợp." />{resource.state === "ready" && <Table rows={rows} columns={[["displayName", "Tên"], ["employeeCode", "Mã nhân sự"], ["employmentType", "Hình thức"], ["status", "Trạng thái"], ["preferredLocale", "Ngôn ngữ"], ["version", "Phiên bản"]]} onSelect={(row) => { window.location.href = `/admin/staff/${row.id}`; }} />}</section>
  </Page>;
}

function StaffForm() {
  const [values, setValues] = useState({ membershipId: "", employeeCode: "", displayName: "", legalName: "", preferredName: "", levelCode: "", employmentType: "FULL_TIME", preferredLocale: "vi-VN", hireDate: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await api("/v1/staff", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ ...values, membershipId: values.membershipId || null, hireDate: values.hireDate || null, notes: values.notes || null }) }); setNotice("Đã tạo hồ sơ nhân sự."); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tạo hồ sơ nhân sự."); }
    finally { setBusy(false); }
  }
  const fields: Array<[string, string, string, boolean]> = [["employeeCode", "Mã nhân sự", "text", true], ["displayName", "Tên hiển thị", "text", true], ["legalName", "Tên pháp lý", "text", false], ["preferredName", "Tên thường gọi", "text", false], ["membershipId", "Mã Membership", "text", false], ["levelCode", "Mã cấp bậc", "text", false], ["hireDate", "Ngày bắt đầu", "date", false], ["notes", "Ghi chú", "text", false]];
  return <Page eyebrow="NHÂN SỰ" title="Tạo hồ sơ nhân sự" description="Thêm hồ sơ vận hành mà không mở dữ liệu lương hoặc thông tin riêng tư không cần thiết.">
    <form className="s19-card s19-form-grid" onSubmit={submit}>{fields.map(([key, label, type, required]) => <Field key={key} name={key} label={label} type={type} required={required} value={values[key as keyof typeof values]} onChange={set(key)} />)}<label className="s19-field"><span>Hình thức làm việc</span><select value={values.employmentType} onChange={(event) => set("employmentType")(event.target.value)}><option value="FULL_TIME">Toàn thời gian</option><option value="PART_TIME">Bán thời gian</option><option value="CONTRACTOR">Cộng tác viên</option><option value="TEMPORARY">Tạm thời</option></select></label><label className="s19-field"><span>Ngôn ngữ ưu tiên</span><select value={values.preferredLocale} onChange={(event) => set("preferredLocale")(event.target.value)}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></label><div className="s19-inline-actions s19-field-wide"><button className="s19-button s19-button-primary" disabled={busy}>{busy ? "Đang tạo…" : "Tạo hồ sơ"}</button><a className="s19-button s19-button-secondary" href="/admin/staff/list">Hủy</a></div>{error && <p className="s19-notice s19-notice-danger s19-field-wide">{error}</p>}{notice && <p className="s19-notice s19-notice-success s19-field-wide">{notice}</p>}</form>
  </Page>;
}

function StaffDetail({ id }: { id: string }) {
  const profile = useResource(`/v1/staff/${id}`);
  const branches = useResource(`/v1/staff/${id}/branches`);
  const skills = useResource(`/v1/staff/${id}/skills`);
  const mutation = useMutation(profile.reload);
  if (profile.state !== "ready") return <Page eyebrow="NHÂN SỰ" title="Hồ sơ nhân sự" description="Phân công và kỹ năng được giới hạn theo tenant và chi nhánh."><StatePanel state={profile.state} error={profile.error} retry={profile.reload} /></Page>;
  const row = profile.rows[0] ?? {};
  return <Page eyebrow="NHÂN SỰ" title={row.displayName ?? "Hồ sơ nhân sự"} description="Hồ sơ vận hành, phân công chi nhánh và kỹ năng dịch vụ." actions={<a className="s19-button s19-button-secondary" href="/admin/staff/list">Về danh sách</a>}>
    <div className="s19-w4-grid"><section className="s19-card"><h2>Thông tin hồ sơ</h2><dl className="s19-w4-dl">{[["Mã nhân sự", row.employeeCode], ["Hình thức", row.employmentType], ["Trạng thái", row.status], ["Ngôn ngữ", row.preferredLocale], ["Phiên bản", row.version]].map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{format(value)}</dd></div>)}</dl><div className="s19-inline-actions"><ActionButton label="Tạm ngưng" onClick={() => mutation.run(`/v1/staff/${id}/suspend`, { version: row.version })} danger /><ActionButton label="Kích hoạt" onClick={() => mutation.run(`/v1/staff/${id}/activate`, { version: row.version })} />{mutation.notice && <span className="s19-notice-success">{mutation.notice}</span>}{mutation.error && <span className="s19-notice-danger">{mutation.error}</span>}</div></section><section className="s19-card"><h2>Phân công chi nhánh</h2><StatePanel state={branches.state} error={branches.error} retry={branches.reload} empty="Chưa có phân công chi nhánh." />{branches.state === "ready" && <Table rows={branches.rows} columns={[["branchId", "Chi nhánh"], ["isPrimary", "Chính"], ["canBeBooked", "Có thể đặt lịch"], ["status", "Trạng thái"]]} />}</section><section className="s19-card"><h2>Kỹ năng</h2><StatePanel state={skills.state} error={skills.error} retry={skills.reload} empty="Chưa có kỹ năng được gán." />{skills.state === "ready" && <Table rows={skills.rows} columns={[["skillId", "Kỹ năng"], ["level", "Cấp độ"], ["status", "Trạng thái"]]} />}</section></div>
  </Page>;
}
