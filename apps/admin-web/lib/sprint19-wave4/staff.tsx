/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useRef, useState } from "react";
import { api, ActionButton, Field, Page, StatePanel, Table, useMutation, useResource, wave4Text } from "./shared";

export default function StaffWorkspace({ pathname }: { pathname: string }) {
  const id = pathname.match(/^\/admin\/staff\/([^/]+)$/)?.[1];
  if (pathname === "/admin/staff/new") return <StaffForm />;
  if (id && id !== "list") return <StaffDetail id={id} />;
  return <StaffDirectory />;
}
function maskedEmail(value: unknown) {
  const email = String(value ?? "");
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}
function StaffDirectory() {
  const resource = useResource("/v1/staff");
  const [q, setQ] = useState("");
  const rows = resource.rows.filter((row) => !q || `${row.displayName} ${row.employeeCode}`.toLowerCase().includes(q.toLowerCase()));
  return <Page eyebrow="People" title="Staff directory" description="Tra cứu hồ sơ vận hành, hình thức làm việc và phân công chi nhánh." actions={<a className="s19-button s19-button-primary" href="/admin/staff/new">{wave4Text("Add staff")}</a>}><section className="s19-card"><div className="s19-w4-toolbar"><label className="s19-field"><span>{wave4Text("Search staff")}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={wave4Text("Name or employee code")} /></label><button className="s19-button s19-button-secondary" onClick={resource.reload}>{wave4Text("Refresh")}</button></div><StatePanel state={resource.state} error={resource.error} retry={resource.reload} empty="No staff profiles match this workspace." />{resource.state === "ready" && <Table rows={rows} columns={[["displayName", "Name"], ["employeeCode", "Employee code"], ["employmentType", "Employment"], ["status", "Status"], ["preferredLocale", "Locale"], ["version", "Version"]]} onSelect={(row) => { window.location.href = `/admin/staff/${row.id}`; }} />}</section></Page>;
}
function StaffForm() {
  const [values, setValues] = useState({ membershipId: "", employeeCode: "", displayName: "", legalName: "", preferredName: "", levelCode: "", employmentType: "FULL_TIME", preferredLocale: "vi-VN", hireDate: "", notes: "" });
  const users = useResource("/v1/users");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const createIntent = useRef("");
  const set = (key: string) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      createIntent.current ||= crypto.randomUUID();
      await api("/v1/staff", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": createIntent.current }, body: JSON.stringify({ ...values, membershipId: values.membershipId || null, hireDate: values.hireDate || null, notes: values.notes || null }) });
      setNotice(wave4Text("Staff profile created"));
      setValues({ membershipId: "", employeeCode: "", displayName: "", legalName: "", preferredName: "", levelCode: "", employmentType: "FULL_TIME", preferredLocale: "vi-VN", hireDate: "", notes: "" });
      createIntent.current = "";
    } catch (cause: any) { setError(wave4Text(cause?.message ?? "Unable to create staff")); } finally { setBusy(false); }
  }
  return <Page eyebrow="Nhân sự" title="Tạo hồ sơ nhân sự" description="Thêm hồ sơ vận hành trong đúng salon; dữ liệu lương và danh tính riêng tư không được mở rộng ngoài quyền hiện tại."><form className="s19-card s19-form-grid" onSubmit={submit}>
    <div className="s19-w4-toolbar s19-field-wide"><div><span className="s19-payout-section-kicker">HỒ SƠ VẬN HÀNH</span><h2 className="s19-payout-section-title">Thông tin nhân sự</h2><p className="s19-helper">Các trường bắt buộc được máy chủ xác thực trước khi tạo hồ sơ.</p></div><span className="s19-w4-live-indicator">● Dữ liệu máy chủ</span></div>
    {[["employeeCode", "Employee code", "text", true], ["displayName", "Display name", "text", true], ["legalName", "Legal name", "text", false], ["preferredName", "Preferred name", "text", false]].map(([key, label, type, required]) => <Field key={key as string} name={key as string} label={label as string} type={type as string} required={required as boolean} value={values[key as keyof typeof values]} onChange={set(key as string)} />)}
    <label className="s19-field"><span>Gắn tài khoản đăng nhập (không bắt buộc)</span><select name="membershipId" value={values.membershipId} onChange={(event) => set("membershipId")(event.target.value)} disabled={users.state === "loading"} aria-describedby="staff-account-help"><option value="">Không gắn tài khoản</option>{users.state === "ready" && users.rows.filter((user) => user.membershipId && user.status !== "SUSPENDED").map((user) => <option key={user.membershipId} value={user.membershipId}>{user.displayName ?? "Tài khoản không có tên"}{maskedEmail(user.email) ? ` · ${maskedEmail(user.email)}` : ""}</option>)}</select><small id="staff-account-help">Chỉ chọn tài khoản thuộc salon hiện tại; không cần nhập mã hệ thống thủ công.</small>{users.state === "forbidden" && <small>Danh sách tài khoản không được cấp quyền; hồ sơ vẫn có thể tạo mà không gắn tài khoản.</small>}{users.state === "error" && <small>Không tải được danh sách tài khoản; bạn có thể tiếp tục mà không gắn tài khoản.</small>}</label>
    <Field name="levelCode" label="Level code" type="text" required={false} value={values.levelCode} onChange={set("levelCode")} /><Field name="hireDate" label="Hire date" type="date" required={false} value={values.hireDate} onChange={set("hireDate")} /><Field name="notes" label="Notes" type="text" required={false} value={values.notes} onChange={set("notes")} /><label className="s19-field"><span>{wave4Text("Employment type")}</span><select name="employmentType" value={values.employmentType} onChange={(e) => set("employmentType")(e.target.value)}><option value="FULL_TIME">{wave4Text("FULL_TIME")}</option><option value="PART_TIME">{wave4Text("PART_TIME")}</option><option value="CONTRACTOR">{wave4Text("CONTRACTOR")}</option><option value="TEMPORARY">{wave4Text("TEMPORARY")}</option></select></label><label className="s19-field"><span>{wave4Text("Preferred locale")}</span><select name="preferredLocale" value={values.preferredLocale} onChange={(e) => set("preferredLocale")(e.target.value)}><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label><div className="s19-inline-actions s19-field-wide"><button className="s19-button s19-button-primary" disabled={busy}>{busy ? wave4Text("Creating…") : wave4Text("Create profile")}</button><a className="s19-button s19-button-secondary" href="/admin/staff/list">{wave4Text("Cancel")}</a></div>{error && <p className="s19-notice s19-notice-danger s19-field-wide" role="alert">{error}</p>}{notice && <p className="s19-notice s19-notice-success s19-field-wide" role="status">{notice}</p>}</form></Page>;
}
function StaffDetail({ id }: { id: string }) {
  const profile = useResource(`/v1/staff/${id}`); const branches = useResource(`/v1/staff/${id}/branches`); const skills = useResource(`/v1/staff/${id}/skills`); const branchDirectory = useResource("/v1/branches"); const skillDirectory = useResource("/v1/skills"); const mutation = useMutation(profile.reload);
  if (profile.state !== "ready") return <Page eyebrow="People" title="Staff profile" description="Assignments and skills are scoped to the current tenant and branch."><StatePanel state={profile.state} error={profile.error} retry={profile.reload} /></Page>;
  const row = profile.rows[0] ?? {};
  const named = (value: any, directory: any[], fallback: string) => {
    const item = directory.find((candidate) => candidate.id === value);
    if (!item) return value ? fallback : null;
    if (typeof item.name === "string") return item.name;
    return item.name?.["vi-VN"] ?? item.name?.["en-US"] ?? item.displayName ?? item.code ?? fallback;
  };
  const branchRows = branches.rows.map((item) => ({ ...item, branchId: named(item.branchId, branchDirectory.rows, "Chi nhánh đã được phân công") }));
  const skillRows = skills.rows.map((item) => ({ ...item, skillId: named(item.skillId, skillDirectory.rows, "Kỹ năng đã được gán"), level: item.level ?? item.proficiencyLevel }));
  return <Page eyebrow="People" title={row.displayName ?? "Staff profile"} description="Operational profile, branch assignments and service skills." actions={<a className="s19-button s19-button-secondary" href="/admin/staff/list">{wave4Text("Back to directory")}</a>}><div className="s19-w4-grid"><section className="s19-card"><h2>{wave4Text("Profile")}</h2><dl className="s19-w4-dl">{[["Employee code", row.employeeCode], ["Employment", row.employmentType], ["Status", row.status], ["Locale", row.preferredLocale], ["Version", row.version]].map(([label, value]) => <div key={label as string}><dt>{wave4Text(label as string)}</dt><dd>{wave4Text(String(value ?? "—"))}</dd></div>)}</dl><div className="s19-inline-actions"><ActionButton label="Suspend" onClick={() => mutation.run(`/v1/staff/${id}/suspend`, {})} danger /><ActionButton label="Activate" onClick={() => mutation.run(`/v1/staff/${id}/activate`, {})} />{mutation.notice && <span className="s19-notice-success">{mutation.notice}</span>}{mutation.error && <span className="s19-notice-danger">{mutation.error}</span>}</div></section><section className="s19-card"><h2>{wave4Text("Branch assignments")}</h2><StatePanel state={branches.state} error={branches.error} retry={branches.reload} empty="No branch assignments." />{branches.state === "ready" && <Table rows={branchRows} columns={[["branchId", "Branch"], ["isPrimary", "Primary"], ["canBeBooked", "Bookable"], ["status", "Status"]]} />}</section><section className="s19-card"><h2>{wave4Text("Skills")}</h2><StatePanel state={skills.state} error={skills.error} retry={skills.reload} empty="No skills assigned." />{skills.state === "ready" && <Table rows={skillRows} columns={[["skillId", "Skill"], ["level", "Level"], ["status", "Status"]]} />}</section></div></Page>;
}
