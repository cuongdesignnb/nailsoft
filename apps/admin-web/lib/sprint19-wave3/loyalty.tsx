/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useState } from "react";
import { BenefitShell, BenefitStatePanel, formatDate, formatInteger, formatMoney, localized, rows, statusLabel, useBenefitMutation, useBenefitResource, useCustomerLookup } from "./benefit-shared";
import LoyaltyCustomerPage from "./loyalty-customer/loyalty-customer-page";

function MutationNotice({ mutation }: { mutation: ReturnType<typeof useBenefitMutation> }) {
  if (mutation.state === "submitting") return <p className="s19-notice" role="status">Đang lưu…</p>;
  if (mutation.state === "success") return <p className="s19-notice s19-notice-success" role="status">{mutation.message}</p>;
  if (mutation.state === "error") return <p className="s19-notice s19-notice-danger" role="alert">{mutation.code ? `${mutation.code}: ` : ""}{mutation.message}</p>;
  return null;
}

function ProgramForm({ onSaved }: { onSaved: () => void }) {
  const mutation = useBenefitMutation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const from = String(form.get("effectiveFrom") ?? "");
    if (!name || !from) return;
    const result = await mutation.submit("/v1/loyalty-programs", {
      name, earnBasis: "NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP",
      spendMinorPerPoint: Number(form.get("spendMinorPerPoint")),
      redemptionPoints: Number(form.get("redemptionPoints")),
      redemptionMinor: Number(form.get("redemptionMinor")),
      settlementDelayHours: 24, pointsValidDays: 365,
      effectiveFrom: new Date(from).toISOString(), policy: {},
    });
    if (result) { event.currentTarget.reset(); onSaved(); }
  }
  return <form className="s19-benefit-form" onSubmit={(event) => void submit(event)}><div className="s19-form-grid"><label className="s19-field"><span>Tên chương trình</span><input name="name" required /></label><label className="s19-field"><span>Mức chi tiêu cho 1 điểm (đồng)</span><input name="spendMinorPerPoint" type="number" min="1" required /><small>Nhập số tiền nguyên theo đơn vị tiền tệ của salon.</small></label><label className="s19-field"><span>Số điểm cho mỗi lần đổi</span><input name="redemptionPoints" type="number" min="1" required /></label><label className="s19-field"><span>Giá trị mỗi lần đổi (đồng)</span><input name="redemptionMinor" type="number" min="1" required /><small>Tỷ lệ đổi được lưu nguyên trong chính sách Loyalty.</small></label><label className="s19-field"><span>Hiệu lực từ</span><input name="effectiveFrom" type="datetime-local" required /></label></div><p className="s19-helper">Tỷ lệ tích và đổi được máy chủ kiểm tra bằng số nguyên; việc áp dụng điểm vẫn tuân theo giao dịch đủ điều kiện tại POS.</p><button className="s19-button s19-button-primary" disabled={mutation.state === "submitting"}>Tạo chương trình</button><MutationNotice mutation={mutation} /></form>;
}

export default function LoyaltyPrograms() {
  const resource = useBenefitResource("/v1/loyalty-programs");
  const values = rows(resource.data);
  return <BenefitShell title="Loyalty programs" eyebrow="LOYALTY MANAGEMENT"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">DANH MỤC CHƯƠNG TRÌNH</p><h2>Chính sách tích điểm hiệu lực</h2></div><span className="s19-privacy-label">Dữ liệu từ máy chủ</span></div><BenefitStatePanel resource={resource} label="loyalty programs" />{resource.state === "ready" ? <div className="s19-benefit-table-wrap"><table className="s19-benefit-table"><thead><tr><th scope="col">Chương trình</th><th scope="col">Cách tích điểm</th><th scope="col">Đổi thưởng</th><th scope="col">Hiệu lực</th><th scope="col">Trạng thái</th></tr></thead><tbody>{values.map((item: any) => <tr key={item.id}><td data-label="Chương trình"><strong>{localized(item.name, item.code)}</strong><small>{item.code ?? "Mã hệ thống"}</small></td><td data-label="Cách tích điểm">{statusLabel(item.earnBasis ?? item.earn_basis)}</td><td data-label="Đổi thưởng">{formatInteger(item.redemptionPoints ?? item.redemption_points)} điểm / {formatMoney(item.redemptionMinor ?? item.redemption_minor)}</td><td data-label="Hiệu lực">{formatDate(item.effectiveFrom ?? item.effective_from)}<small>đến {formatDate(item.effectiveTo ?? item.effective_to)}</small></td><td data-label="Trạng thái"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span></td></tr>)}</tbody></table></div> : null}</section><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">THAY ĐỔI CÓ KIỂM SOÁT</p><h2>Tạo chương trình</h2></div></div><p className="s19-helper">Máy chủ kiểm tra chồng lấn chính sách và lưu bằng chứng audit. Chương trình hiện có không được sửa trực tiếp.</p><ProgramForm onSaved={() => void resource.load()} /></section></BenefitShell>;
}

export function CustomerLoyalty({ customerId }: { customerId: string }) {
  return <LoyaltyCustomerPage customerId={customerId} />;
}

export function LoyaltyAdjustments() {
  const resource = useBenefitResource("/v1/loyalty-adjustments");
  const mutation = useBenefitMutation();
  const lookup = useCustomerLookup();
  const [selectedCustomer, setSelectedCustomer] = useState<any>();
  const [validationError, setValidationError] = useState("");
  const values = rows(resource.data);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomer?.id) {
      setValidationError("Hãy tìm và chọn một khách hàng trước khi tạo yêu cầu.");
      return;
    }
    setValidationError("");
    const form = new FormData(event.currentTarget);
    const result = await mutation.submit("/v1/loyalty-adjustments", { customerId: selectedCustomer.id, pointsDelta: Number(form.get("pointsDelta")), reasonCode: String(form.get("reasonCode")), note: String(form.get("note")) });
    if (result) { setSelectedCustomer(undefined); lookup.setQuery(""); event.currentTarget.reset(); void resource.load(); }
  }

  async function decide(item: any, action: "approve" | "reject") {
    const result = await mutation.submit(`/v1/loyalty-adjustments/${item.id}/${action}`, { version: Number(item.version ?? 1), reason: action === "approve" ? "Phê duyệt bởi người kiểm tra độc lập." : "Người kiểm tra từ chối yêu cầu điều chỉnh." });
    if (result) void resource.load();
  }

  return <BenefitShell title="Loyalty adjustments" eyebrow="CONTROLLED BENEFIT OPERATIONS"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">YÊU CẦU ĐIỀU CHỈNH</p><h2>Tạo yêu cầu điều chỉnh</h2></div></div><p className="s19-helper">Yêu cầu phải được một người đã xác thực khác phê duyệt. Người tạo không thể tự phê duyệt yêu cầu của mình.</p><form className="s19-benefit-form" onSubmit={(event) => void create(event)}><div className="s19-form-grid"><div className="s19-field s19-field-wide"><span>Khách hàng</span>{selectedCustomer ? <div className="s19-benefit-result"><span><strong>{selectedCustomer.displayName ?? selectedCustomer.name ?? "Khách hàng"}</strong><small>Đã chọn từ danh sách khách hàng được phép xem</small></span><button className="s19-button s19-button-small" type="button" onClick={() => setSelectedCustomer(undefined)}>Đổi khách hàng</button></div> : <><div className="s19-benefit-search"><label className="s19-field"><span className="s19-sr-only">Tìm khách hàng</span><input value={lookup.query} onChange={(event) => lookup.setQuery(event.target.value)} placeholder="Tìm theo tên hoặc thông tin được phép xem" aria-label="Tìm khách hàng" /></label><button className="s19-button s19-button-small" type="button" onClick={lookup.search} disabled={!lookup.query.trim() || lookup.resource.state === "loading"}>Tìm</button></div>{lookup.resource.state === "loading" ? <small>Đang tìm khách hàng…</small> : null}{lookup.resource.state === "error" || lookup.resource.state === "forbidden" ? <small role="alert">Không thể tìm khách hàng với quyền hiện tại.</small> : null}{lookup.results.length ? <div className="s19-benefit-customer-results">{lookup.results.slice(0, 5).map((customer: any) => <button className="s19-benefit-result" key={customer.id} type="button" onClick={() => setSelectedCustomer(customer)}><span><strong>{customer.displayName ?? customer.name ?? "Khách hàng"}</strong><small>{customer.customerCode ?? customer.phoneMasked ?? "Thông tin liên hệ được bảo vệ"}</small></span><span aria-hidden="true">›</span></button>)}</div> : null}</>}</div><label className="s19-field"><span>Thay đổi điểm</span><input name="pointsDelta" type="number" min="-1000000" max="1000000" required /></label><label className="s19-field"><span>Mã lý do</span><input name="reasonCode" required /></label><label className="s19-field s19-field-wide"><span>Ghi chú chứng từ</span><textarea name="note" minLength={3} required /></label></div>{validationError ? <p className="s19-notice s19-notice-danger" role="alert">{validationError}</p> : null}<button className="s19-button s19-button-primary" disabled={mutation.state === "submitting" || !selectedCustomer?.id}>Tạo yêu cầu</button><MutationNotice mutation={mutation} /></form></section><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">HÀNG ĐỢI PHÊ DUYỆT</p><h2>Yêu cầu đang chờ và lịch sử</h2></div></div><BenefitStatePanel resource={resource} label="loyalty adjustments" />{resource.state === "ready" ? <div className="s19-benefit-stack">{values.map((item: any) => <article className="s19-benefit-item" key={item.id}><div><strong>{formatInteger(item.pointsDelta ?? item.points_delta)} điểm</strong><span>{statusLabel(item.reasonCode ?? item.reason_code ?? "UNKNOWN")}</span><small>Tạo lúc {formatDate(item.createdAt ?? item.created_at)} · Thông tin khách hàng được bảo vệ theo quyền truy cập</small></div><div className="s19-inline-actions"><span className="s19-status s19-status-info">{statusLabel(item.status)}</span>{String(item.status).toUpperCase() === "PENDING" ? <><button className="s19-button s19-button-small" type="button" onClick={() => void decide(item, "approve")}>Phê duyệt</button><button className="s19-button s19-button-small s19-button-danger" type="button" onClick={() => void decide(item, "reject")}>Từ chối</button></> : null}</div></article>)}</div> : null}</section></BenefitShell>;
}
