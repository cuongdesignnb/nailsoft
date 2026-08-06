/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { BenefitShell, BenefitStatePanel, CustomerBenefitHeader, formatDate, formatInteger, localized, partialState, safeVoucherCode, statusLabel, useBenefitResource, useCustomerLookup } from "./benefit-shared";

function CustomerPicker() {
  const lookup = useCustomerLookup();
  return <section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">CUSTOMER LOOKUP</p><h2>Select a customer</h2></div></div><form className="s19-benefit-search" role="search" onSubmit={(event) => { event.preventDefault(); lookup.search(); }}><label className="s19-field" htmlFor="benefit-customer-search"><span>Search customers</span><input id="benefit-customer-search" value={lookup.query} onChange={(event) => lookup.setQuery(event.target.value)} placeholder="Name, phone or email" autoComplete="off" /></label><button className="s19-button s19-button-primary" type="submit">Search</button></form><BenefitStatePanel resource={lookup.resource} label="customers" />{lookup.resource.state === "ready" ? <div className="s19-benefit-customer-results">{lookup.results.length ? lookup.results.map((customer: any) => <a className="s19-benefit-result" href={`/admin/benefits/customers/${customer.id}`} key={customer.id}><span><strong>{customer.displayName}</strong><small>{customer.phone ?? customer.email ?? "Contact hidden"}</small></span><span className="s19-status s19-status-info">{statusLabel(customer.status)}</span></a>) : <p className="s19-helper">No matching customer found.</p>}</div> : null}</section>;
}

function LoyaltyCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const data = resource.data ?? {};
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">LOYALTY</p><h2>Points wallet</h2></div><a href="/admin/loyalty/programs">Manage program</a></div><BenefitStatePanel resource={resource} label="loyalty balance" />{resource.state === "ready" ? <dl className="s19-benefit-metrics"><div><dt>Available points</dt><dd>{formatInteger(data.availablePoints)}</dd></div><div><dt>Pending points</dt><dd>{formatInteger(data.pendingPoints)}</dd></div><div><dt>Reserved points</dt><dd>{formatInteger(data.reservedPoints)}</dd></div><div><dt>Lifetime earned</dt><dd>{formatInteger(data.lifetimeEarnedPoints)}</dd></div></dl> : null}</section>;
}

function MembershipCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const item = Array.isArray(resource.data) ? resource.data[0] : resource.data;
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">MEMBERSHIP</p><h2>Current tier</h2></div><a href="/admin/membership/tiers">View tiers</a></div><BenefitStatePanel resource={resource} label="membership" />{resource.state === "ready" && item ? <dl className="s19-benefit-detail-list"><div><dt>Tier</dt><dd>{localized(item.tierName ?? item.name ?? item.code)}</dd></div><div><dt>Status</dt><dd><span className="s19-status s19-status-success">{statusLabel(item.status)}</span></dd></div><div><dt>Effective from</dt><dd>{formatDate(item.effectiveFrom ?? item.effective_from)}</dd></div><div><dt>Effective to</dt><dd>{formatDate(item.effectiveTo ?? item.effective_to)}</dd></div></dl> : resource.state === "ready" ? <p className="s19-helper">No active membership tier.</p> : null}</section>;
}

function VouchersCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const values = Array.isArray(resource.data) ? resource.data : [];
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">VOUCHERS</p><h2>Masked vouchers</h2></div><span className="s19-privacy-label">Secrets hidden</span></div><BenefitStatePanel resource={resource} label="vouchers" />{resource.state === "ready" ? values.length ? <div className="s19-benefit-stack">{values.map((voucher: any) => <article className="s19-benefit-item" key={voucher.id}><div><strong>{safeVoucherCode(voucher)}</strong><span>{voucher.campaignName ?? "Voucher campaign"}</span></div><div><span className="s19-status s19-status-info">{statusLabel(voucher.status)}</span><small>Expires {formatDate(voucher.expiresAt)}</small></div></article>)}</div> : <p className="s19-helper">No active vouchers.</p> : null}</section>;
}

function PackagesCard({ resource }: { resource: ReturnType<typeof useBenefitResource> }) {
  const values = Array.isArray(resource.data) ? resource.data : [];
  return <section className="s19-benefit-panel"><div className="s19-benefit-panel-heading"><div><p className="s19-eyebrow">SERVICE PACKAGES</p><h2>Package entitlements</h2></div><a href="/admin/packages/entitlements">Open entitlements</a></div><BenefitStatePanel resource={resource} label="package entitlements" />{resource.state === "ready" ? values.length ? <div className="s19-benefit-stack">{values.map((item: any) => <article className="s19-benefit-item" key={item.id}><div><strong>{localized(item.name ?? item.code ?? item.packageProductId)}</strong><span>Issued {formatDate(item.issuedAt)}</span></div><div><b>{formatInteger(item.availableUnits)} available</b><small>Expires {formatDate(item.expiresAt)}</small></div></article>)}</div> : <p className="s19-helper">No package entitlements.</p> : null}</section>;
}

export default function BenefitsWallet({ customerId }: { customerId?: string }) {
  if (!customerId) return <BenefitShell title="Benefits wallet" eyebrow="CUSTOMER BENEFITS"><CustomerPicker /></BenefitShell>;
  const loyalty = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/loyalty`);
  const membership = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/membership`);
  const vouchers = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/vouchers`);
  const packages = useBenefitResource(`/v1/customers/${encodeURIComponent(customerId)}/packages`);
  const partial = partialState([loyalty, membership, vouchers, packages]);
  const expiring = [...(Array.isArray(vouchers.data) ? vouchers.data : []), ...(Array.isArray(packages.data) ? packages.data : [])].filter((item: any) => item.expiresAt);
  return <BenefitShell title="Benefits wallet" eyebrow="CUSTOMER BENEFITS" backHref={`/admin/customers/${customerId}`}><CustomerBenefitHeader customerId={customerId} backHref={`/admin/customers/${customerId}`} />{partial ? <div className="s19-notice s19-notice-warning" role="status">Some optional benefit sections are unavailable for your current permission.</div> : null}<div className="s19-benefit-grid"><LoyaltyCard resource={loyalty} /><MembershipCard resource={membership} /><VouchersCard resource={vouchers} /><PackagesCard resource={packages} /></div><section className="s19-card s19-benefit-expiry"><div className="s19-card-heading"><div><p className="s19-eyebrow">EXPIRING BENEFITS</p><h2>Upcoming expiry evidence</h2></div></div>{expiring.length ? <div className="s19-benefit-stack">{expiring.map((item: any, index) => <article className="s19-benefit-item" key={item.id ?? `expiry-${index}`}><div><strong>{item.codeLast4 ? safeVoucherCode(item) : localized(item.name ?? item.code ?? "Service package")}</strong><span>Server-provided expiry</span></div><time>{formatDate(item.expiresAt)}</time></article>)}</div> : <p className="s19-helper">No expiring benefits were returned.</p>}</section></BenefitShell>;
}
