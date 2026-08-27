"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useState } from "react";
import {
  BenefitShell,
  BenefitStatePanel,
  formatDate,
  formatMoney,
  rows,
  safeVoucherCode,
  statusLabel,
  useBenefitMutation,
  useBenefitResource,
} from "./benefit-shared";

function splitIds(value: string) {
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "s19-field s19-field-wide" : "s19-field"}><span>{label}</span>{children}</label>;
}

export function VoucherCampaigns() {
  const resource = useBenefitResource("/v1/voucher-campaigns");
  const mutation = useBenefitMutation();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", discountType: "PERCENT", discountValue: "", currency: "VND", minimumSpendMinor: "0", validFrom: "", validUntil: "", totalUseLimit: "", perCustomerUseLimit: "", codeUseLimit: "1", branchIds: "", serviceIds: "", customerIds: "", membershipTierIds: "" });
  const campaigns = rows(resource.data);
  const set = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }));
  async function create(event: FormEvent) {
    event.preventDefault();
    const value = await mutation.submit("/v1/voucher-campaigns", {
      name: form.name.trim(), discountType: form.discountType, discountValue: Number(form.discountValue), currency: form.discountType === "FIXED" ? form.currency : undefined,
      minimumSpendMinor: Number(form.minimumSpendMinor || 0), totalUseLimit: form.totalUseLimit ? Number(form.totalUseLimit) : undefined,
      perCustomerUseLimit: form.perCustomerUseLimit ? Number(form.perCustomerUseLimit) : undefined, codeUseLimit: Number(form.codeUseLimit || 1),
      branchIds: splitIds(form.branchIds), serviceIds: splitIds(form.serviceIds), customerIds: splitIds(form.customerIds), membershipTierIds: splitIds(form.membershipTierIds),
      eligibilityPolicy: {}, refundPolicy: "DO_NOT_RESTORE", validFrom: new Date(form.validFrom).toISOString(), validUntil: new Date(form.validUntil).toISOString(),
    });
    if (value !== undefined) { setShowCreate(false); setForm({ name: "", discountType: "PERCENT", discountValue: "", currency: "VND", minimumSpendMinor: "0", validFrom: "", validUntil: "", totalUseLimit: "", perCustomerUseLimit: "", codeUseLimit: "1", branchIds: "", serviceIds: "", customerIds: "", membershipTierIds: "" }); await resource.load(); }
  }
  return <BenefitShell title="Voucher campaigns" eyebrow="CUSTOMER BENEFITS · VOUCHERS" backHref="/admin/benefits">
    <div className="s19-card-heading"><div><p className="s19-helper">Tạo và vận hành chương trình Voucher theo vòng đời được máy chủ kiểm soát.</p></div><button className="s19-button s19-button-primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Đóng biểu mẫu" : "Tạo chương trình"}</button></div>
    {showCreate && <form className="s19-card s19-benefit-form" onSubmit={(event) => void create(event)}><div className="s19-form-grid">
      <Field label="Tên chương trình"><input required value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
      <Field label="Loại giảm giá"><select value={form.discountType} onChange={(event) => set("discountType", event.target.value)}><option value="PERCENT">Phần trăm</option><option value="FIXED">Số tiền cố định</option></select></Field>
      <Field label="Giá trị giảm"><input required type="number" min="1" value={form.discountValue} onChange={(event) => set("discountValue", event.target.value)} /></Field>
      <Field label="Tiền tệ"><input maxLength={3} value={form.currency} onChange={(event) => set("currency", event.target.value.toUpperCase())} /></Field>
      <Field label="Mức chi tối thiểu (minor)"><input type="number" min="0" value={form.minimumSpendMinor} onChange={(event) => set("minimumSpendMinor", event.target.value)} /></Field>
      <Field label="Giới hạn dùng mỗi mã"><input type="number" min="1" value={form.codeUseLimit} onChange={(event) => set("codeUseLimit", event.target.value)} /></Field>
      <Field label="Có hiệu lực từ"><input required type="datetime-local" value={form.validFrom} onChange={(event) => set("validFrom", event.target.value)} /></Field>
      <Field label="Có hiệu lực đến"><input required type="datetime-local" value={form.validUntil} onChange={(event) => set("validUntil", event.target.value)} /></Field>
      <Field label="Tổng giới hạn sử dụng"><input type="number" min="1" value={form.totalUseLimit} onChange={(event) => set("totalUseLimit", event.target.value)} /></Field>
      <Field label="Giới hạn mỗi khách hàng"><input type="number" min="1" value={form.perCustomerUseLimit} onChange={(event) => set("perCustomerUseLimit", event.target.value)} /></Field>
      <p className="s19-helper s19-field-wide">Phạm vi chi nhánh, dịch vụ, khách hàng và hạng Membership chỉ hiển thị khi có bộ chọn dữ liệu thật từ API; màn hình không yêu cầu nhập mã hệ thống thủ công.</p>
    </div><div className="s19-inline-actions"><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>{mutation.state === "submitting" ? "Đang lưu…" : "Lưu bản nháp"}</button>{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></form>}
    {mutation.state === "error" && !showCreate && <div className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div>}
    <BenefitStatePanel resource={resource} label="voucher campaigns" />
    {resource.state === "ready" && <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">Chiến dịch Voucher</caption><thead><tr><th>Tên</th><th>Trạng thái</th><th>Giảm giá</th><th>Hiệu lực</th><th>Sử dụng</th><th>Phiên bản</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td data-label="Tên"><strong><a href={`/admin/vouchers/campaigns/${campaign.id}`}>{campaign.name}</a></strong><small>{campaign.description || "Chưa có mô tả"}</small></td><td data-label="Trạng thái"><span className="s19-status s19-status-info">{statusLabel(campaign.status)}</span></td><td data-label="Giảm giá">{discountValueLabel(campaign)}</td><td data-label="Hiệu lực"><small>{formatDate(campaign.validFrom)}<br />đến {formatDate(campaign.validUntil)}</small></td><td data-label="Sử dụng">{campaign.usedCount ?? 0} / {campaign.totalUseLimit ?? "∞"}</td><td data-label="Phiên bản">{campaign.version ?? "—"}</td></tr>)}</tbody></table></div>}
  </BenefitShell>;
}

function discountValueLabel(campaign: any) { return campaign.discountType === "PERCENT" ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(campaign.discountValue ?? 0) / 100)}%` : formatMoney(campaign.discountValue, campaign.currency || "VND"); }

export function VoucherCampaignDetail({ campaignId }: { campaignId: string }) {
  const resource = useBenefitResource(`/v1/voucher-campaigns/${encodeURIComponent(campaignId)}`);
  const mutation = useBenefitMutation();
  const campaign = resource.data;
  async function transition(action: "activate" | "pause" | "end") { const result = await mutation.submit(`/v1/voucher-campaigns/${campaignId}/${action}`, { version: campaign?.version }); if (result !== undefined) await resource.load(); }
  return <BenefitShell title="Voucher campaign detail" eyebrow="VOUCHERS · LIFECYCLE" backHref="/admin/vouchers/campaigns"><BenefitStatePanel resource={resource} label="voucher campaign" />{campaign && <div className="s19-benefit-grid"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">CHI TIẾT CHƯƠNG TRÌNH</p><h2>{campaign.name}</h2></div><span className="s19-status s19-status-info">{statusLabel(campaign.status)}</span></div><dl className="s19-benefit-detail-list"><div><dt>Giảm giá</dt><dd>{discountValueLabel(campaign)}</dd></div><div><dt>Mức chi tối thiểu</dt><dd>{formatMoney(campaign.minimumSpendMinor, campaign.currency || "VND")}</dd></div><div><dt>Có hiệu lực từ</dt><dd>{formatDate(campaign.validFrom ?? campaign.valid_from)}</dd></div><div><dt>Có hiệu lực đến</dt><dd>{formatDate(campaign.validUntil ?? campaign.valid_until)}</dd></div><div><dt>Sử dụng</dt><dd>{campaign.usedCount ?? campaign.used_count ?? 0} / {campaign.totalUseLimit ?? campaign.total_use_limit ?? "∞"}</dd></div><div><dt>Phiên bản</dt><dd>{campaign.version}</dd></div></dl><div className="s19-inline-actions">{campaign.status === "DRAFT" && <button className="s19-button s19-button-primary" onClick={() => void transition("activate")}>Kích hoạt</button>}{campaign.status === "ACTIVE" && <><button className="s19-button s19-button-secondary" onClick={() => void transition("pause")}>Tạm dừng</button><button className="s19-button s19-button-danger" onClick={() => void transition("end")}>Kết thúc</button></>}{campaign.status === "PAUSED" && <><button className="s19-button s19-button-primary" onClick={() => void transition("activate")}>Tiếp tục</button><button className="s19-button s19-button-danger" onClick={() => void transition("end")}>Kết thúc</button></>}{mutation.message && <span className={mutation.state === "error" ? "s19-notice s19-notice-danger" : "s19-notice s19-notice-success"}>{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</span>}</div></section><VoucherCodeIssue campaignId={campaignId} /></div>}</BenefitShell>;
}

function VoucherCodeIssue({ campaignId }: { campaignId: string }) {
  const mutation = useBenefitMutation();
  const [code, setCode] = useState("");
  const [useLimit, setUseLimit] = useState("1");
  const [issued, setIssued] = useState<any>();
  async function submit(event: FormEvent) { event.preventDefault(); const value = await mutation.submit(`/v1/voucher-campaigns/${campaignId}/codes`, { code, useLimit: Number(useLimit) }); setCode(""); if (value !== undefined) setIssued(value); }
  return <section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">CẤP MÃ VOUCHER</p><h2>Cấp mã Voucher được che</h2></div></div><p className="s19-helper">Mã rõ chỉ được ghi một lần và được xóa sau khi gửi. Chỉ phần cuối đã che mới còn hiển thị.</p><form className="s19-benefit-form" onSubmit={(event) => void submit(event)}><div className="s19-form-grid"><Field label="Mã rõ"><input required minLength={4} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /></Field><Field label="Giới hạn sử dụng"><input required type="number" min="1" value={useLimit} onChange={(event) => setUseLimit(event.target.value)} /></Field></div><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>{mutation.state === "submitting" ? "Đang cấp…" : "Cấp mã"}</button></form>{issued && <div className="s19-notice s19-notice-success" role="status">Đã cấp thành công: <strong>{safeVoucherCode(issued)}</strong></div>}{mutation.state === "error" && <div className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</div>}</section>;
}

export function VoucherCodes() {
  const resource = useBenefitResource("/v1/voucher-codes");
  const campaigns = useBenefitResource("/v1/voucher-campaigns");
  const campaignRows = rows(campaigns.data);
  return <BenefitShell title="Voucher codes" eyebrow="CUSTOMER BENEFITS · VOUCHERS" backHref="/admin/vouchers/campaigns"><BenefitStatePanel resource={campaigns} label="voucher campaigns" partial />{resource.state === "loading" && <div className="s19-state" role="status">Đang tải mã Voucher…</div>}{resource.state === "forbidden" && <div className="s19-state s19-state-danger" role="alert"><strong>Không có quyền truy cập</strong><span>Dữ liệu mã Voucher không khả dụng với quyền hiện tại.</span></div>}{resource.state === "error" && <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải mã Voucher</strong><span>{resource.error}</span><button className="s19-button s19-button-secondary" onClick={() => void resource.load()}>Thử lại</button></div>}{resource.state === "empty" && <div className="s19-state" role="status"><strong>Chưa có mã Voucher</strong><span>Cấp mã từ trang chi tiết chương trình.</span></div>}{resource.state === "ready" && <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><caption className="s19-sr-only">Mã Voucher</caption><thead><tr><th>Mã</th><th>Chương trình</th><th>Trạng thái</th><th>Sử dụng</th><th>Hết hạn</th></tr></thead><tbody>{rows(resource.data).map((item) => <tr key={item.id}><td data-label="Mã"><strong>{safeVoucherCode(item)}</strong><small>Không thể khôi phục mã rõ</small></td><td data-label="Chương trình">{item.campaignName || campaignRows.find((campaign) => campaign.id === item.campaignId)?.name || "—"}</td><td data-label="Trạng thái"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span></td><td data-label="Sử dụng">{item.usedCount ?? 0} / {item.useLimit ?? "∞"}</td><td data-label="Hết hạn">{formatDate(item.expiresAt)}</td></tr>)}</tbody></table></div>}</BenefitShell>;
}
