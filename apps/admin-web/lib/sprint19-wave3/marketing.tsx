"use client";

import { FormEvent, useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, localized, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";
import MarketingHub from "./marketing-hub";

function Field({ label, value, onChange, type = "text", required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="s19-field"><span>{label}</span><input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function BranchSelect({ value, onChange, branches, allowTenantWide = true }: { value: string; onChange: (value: string) => void; branches: Array<{ id: string; name?: unknown }>; allowTenantWide?: boolean }) {
  return <label className="s19-field"><span>Phạm vi chi nhánh</span><select value={value} onChange={(event) => onChange(event.target.value)}>{allowTenantWide && <option value="">Toàn salon (máy chủ kiểm tra)</option>}{branches.map((branch) => <option key={branch.id} value={branch.id}>{localized(branch.name, branch.id)}</option>)}</select></label>;
}

export function MarketingSegments() {
  const resource = useBenefitResource("/v1/customer-segments");
  const branches = useBenefitResource("/v1/branches");
  const mutation = useBenefitMutation();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [locale, setLocale] = useState("ANY");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters: Record<string, unknown> = { marketingConsent: true };
    if (locale !== "ANY") filters.locale = locale;
    const result = await mutation.submit("/v1/customer-segments", { name: name.trim(), branchId: branchId || null, filters });
    if (result) { setName(""); await resource.load(); }
  }
  return <EngagementShell title="Customer segments"><div className="s19-benefit-layout"><form className="s19-card s19-form-grid" onSubmit={submit}><h2>Tạo nhóm khách hàng an toàn consent</h2><Field label="Tên nhóm khách hàng" value={name} onChange={setName} required placeholder="Nhập tên nhóm" /><BranchSelect value={branchId} onChange={setBranchId} branches={rows(branches.data)} /><label className="s19-field"><span>Ngôn ngữ ưu tiên</span><select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="ANY">Tất cả ngôn ngữ</option><option value="vi-VN">vi-VN</option><option value="en-US">en-US</option></select></label><p className="s19-helper">Consent Marketing và Email có thể liên hệ luôn được áp dụng bởi máy chủ. Bộ lọc Customer Tag chưa có danh mục tham chiếu nên không yêu cầu nhập UUID thủ công.</p><button className="s19-button s19-button-primary" type="submit">Tạo nhóm</button></form><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">ĐỊNH NGHĨA ĐỐI TƯỢNG</p><h2>Nhóm khách hàng</h2></div></div><EngagementStates resource={resource} label="nhóm khách hàng" /><SafeTable data={rows(resource.data)} columns={[{ key: "name", label: "Tên nhóm" }, { key: "branch", label: "Chi nhánh", render: (row) => row.branchName ?? row.branchId ?? "Toàn salon" }, { key: "filters", label: "Bộ lọc consent", render: (row) => row.filters?.marketingConsent ? "Consent Marketing" : "Chính sách máy chủ" }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status ?? row.lifecycleStatus) }, { key: "version", label: "Phiên bản" }, { key: "actions", label: "Thao tác", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={row.status === "ACTIVE" ? ["deactivate"] : ["activate"]} onAction={(action) => void mutation.submit(`/v1/customer-segments/${row.id}/${action}`, { version: row.version }).then(() => resource.load())} /> }]} /></section></div><Notice mutation={mutation} /></EngagementShell>;
}

export function MarketingCampaigns() {
  return <MarketingHub />;
}

export function MarketingCampaignDetail({ campaignId }: { campaignId: string }) {
  return <MarketingHub initialCampaignId={campaignId} />;
}
