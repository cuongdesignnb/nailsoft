/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { BenefitShell, BenefitStatePanel, CustomerBenefitHeader, formatDate, formatInteger, localized, partialState, safeVoucherCode, statusLabel, useBenefitResource, useCustomerLookup } from "./benefit-shared";

function CustomerPicker() {
  const lookup = useCustomerLookup();
  return <section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">TRA CỨU KHÁCH HÀNG</p><h2>Chọn khách hàng</h2></div></div><form className="s19-benefit-search" role="search" onSubmit={(event) => { event.preventDefault(); lookup.search(); }}><label className="s19-field" htmlFor="benefit-customer-search"><span>Tìm khách hàng</span><input id="benefit-customer-search" value={lookup.query} onChange={(event) => lookup.setQuery(event.target.value)} placeholder="Tên, số điện thoại hoặc email" autoComplete="off" /></label><button className="s19-button s19-button-primary" type="submit">Tìm kiếm</button></form><BenefitStatePanel resource={lookup.resource} label="customers" />{lookup.resource.state === "ready" ? <div className="s19-benefit-customer-results">{lookup.results.length ? lookup.results.map((customer: any) => <a className="s19-benefit-result" href={`/admin/benefits/customers/${customer.id}`} key={customer.id}><span><strong>{customer.displayName}</strong><small>{customer.phone ?? customer.email ?? "Liên hệ đã ẩn"}</small></span><span className="s19-status s19-status-info">{statusLabel(customer.status)}</span></a>) : <p className="s19-helper">Không tìm thấy khách hàng phù hợp.</p>}</div> : null}</section>;
}

function LoyaltyCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const data = resource.data ?? {};
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">LOYALTY</p><h2>Ví điểm</h2></div><a href="/admin/loyalty/programs">Quản lý chương trình</a></div><BenefitStatePanel resource={resource} label="loyalty balance" />{resource.state === "ready" ? <dl className="s19-benefit-metrics"><div><dt>Điểm khả dụng</dt><dd>{formatInteger(data.availablePoints)}</dd></div><div><dt>Điểm đang chờ</dt><dd>{formatInteger(data.pendingPoints)}</dd></div><div><dt>Điểm đang giữ</dt><dd>{formatInteger(data.reservedPoints)}</dd></div><div><dt>Điểm đã tích lũy</dt><dd>{formatInteger(data.lifetimeEarnedPoints)}</dd></div></dl> : null}</section>;
}

function MembershipCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const item = Array.isArray(resource.data) ? resource.data[0] : resource.data;
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">MEMBERSHIP</p><h2>Hạng hiện tại</h2></div><a href="/admin/membership/tiers">Xem các hạng</a></div><BenefitStatePanel resource={resource} label="membership" />{resource.state === "ready" && item ? <dl className="s19-benefit-detail-list"><div><dt>Hạng</dt><dd>{localized(item.tierName ?? item.name ?? item.code)}</dd></div><div><dt>Trạng thái</dt><dd><span className="s19-status s19-status-success">{statusLabel(item.status)}</span></dd></div><div><dt>Có hiệu lực từ</dt><dd>{formatDate(item.effectiveFrom ?? item.effective_from)}</dd></div><div><dt>Có hiệu lực đến</dt><dd>{formatDate(item.effectiveTo ?? item.effective_to)}</dd></div></dl> : resource.state === "ready" ? <p className="s19-helper">Chưa có hạng Membership đang hoạt động.</p> : null}</section>;
}

function VouchersCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const values = Array.isArray(resource.data) ? resource.data : [];
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">VOUCHER</p><h2>Voucher đã che mã</h2></div><span className="s19-privacy-label">Đã ẩn bí mật</span></div><BenefitStatePanel resource={resource} label="vouchers" />{resource.state === "ready" ? values.length ? <div className="s19-benefit-stack">{values.map((voucher: any) => <article className="s19-benefit-item" key={voucher.id}><div><strong>{safeVoucherCode(voucher)}</strong><span>{voucher.campaignName ?? "Chiến dịch Voucher"}</span></div><div><span className="s19-status s19-status-info">{statusLabel(voucher.status)}</span><small>Hết hạn {formatDate(voucher.expiresAt)}</small></div></article>)}</div> : <p className="s19-helper">Chưa có Voucher đang hoạt động.</p> : null}</section>;
}

function PackagesCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const values = Array.isArray(resource.data) ? resource.data : [];
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">GÓI DỊCH VỤ</p><h2>Quyền sử dụng gói</h2></div><a href="/admin/packages/entitlements">Mở quyền sử dụng</a></div><BenefitStatePanel resource={resource} label="package entitlements" />{resource.state === "ready" ? values.length ? <div className="s19-benefit-stack">{values.map((item: any) => <article className="s19-benefit-item" key={item.id}><div><strong>{localized(item.name ?? item.code ?? item.packageProductId)}</strong><span>Phát hành {formatDate(item.issuedAt)}</span></div><div><b>{formatInteger(item.availableUnits)} lượt khả dụng</b><small>Hết hạn {formatDate(item.expiresAt)}</small></div></article>)}</div> : <p className="s19-helper">Chưa có quyền sử dụng gói dịch vụ.</p> : null}</section>;
}

export default function BenefitsWallet({ customerId }: { customerId?: string }) {
  if (!customerId) return <BenefitShell title="Benefits wallet" eyebrow="CUSTOMER BENEFITS"><CustomerPicker /></BenefitShell>;
  const loyalty = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/loyalty`);
  const membership = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/membership`);
  const vouchers = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/vouchers`);
  const packages = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/packages`);
  const partial = partialState([loyalty, membership, vouchers, packages]);
  const expiring = [...(Array.isArray(vouchers.data) ? vouchers.data : []), ...(Array.isArray(packages.data) ? packages.data : [])].filter((item: any) => item.expiresAt);
  return <BenefitShell title="Benefits wallet" eyebrow="CUSTOMER BENEFITS" backHref={`/admin/customers/${customerId}`}><CustomerBenefitHeader customerId={customerId} backHref={`/admin/customers/${customerId}`} />{partial ? <div className="s19-notice s19-notice-warning" role="status">Một số khu vực quyền lợi tùy chọn không khả dụng với quyền hiện tại.</div> : null}<div className="s19-benefit-grid"><LoyaltyCard resource={loyalty} /><MembershipCard resource={membership} /><VouchersCard resource={vouchers} /><PackagesCard resource={packages} /></div><section className="s19-card s19-benefit-expiry"><div className="s19-card-heading"><div><p className="s19-eyebrow">QUYỀN LỢI SẮP HẾT HẠN</p><h2>Bằng chứng hết hạn sắp tới</h2></div></div>{expiring.length ? <div className="s19-benefit-stack">{expiring.map((item: any, index) => <article className="s19-benefit-item" key={item.id ?? `expiry-${index}`}><div><strong>{item.codeLast4 ? safeVoucherCode(item) : localized(item.name ?? item.code ?? "Gói dịch vụ")}</strong><span>Ngày hết hạn do máy chủ cung cấp</span></div><time>{formatDate(item.expiresAt)}</time></article>)}</div> : <p className="s19-helper">Không có quyền lợi sắp hết hạn được trả về.</p>}</section></BenefitShell>;
}
