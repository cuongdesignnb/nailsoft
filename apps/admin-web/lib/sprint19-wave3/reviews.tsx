"use client";

import { useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, formatDate, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";

export function Reviews() {
  const resource = useBenefitResource("/v1/reviews");
  return <EngagementShell title="Reviews"><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">TIẾNG NÓI KHÁCH HÀNG</p><h2>Đánh giá đã xác minh</h2></div></div><EngagementStates resource={resource} label="đánh giá" /><SafeTable data={rows(resource.data)} columns={[{ key: "rating", label: "Điểm", render: (row) => <strong aria-label={`${row.rating ?? 0} trên 5`}>{row.rating ?? "-"}/5</strong> }, { key: "customer", label: "Khách hàng", render: (row) => row.customerDisplayName ?? row.customerName ?? "Khách hàng" }, { key: "status", label: "Trạng thái", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status)}</span> }, { key: "branchId", label: "Chi nhánh" }, { key: "submittedAt", label: "Gửi lúc", render: (row) => formatDate(row.submittedAt ?? row.createdAt) }, { key: "id", label: "Mở", render: (row) => <a className="s19-button s19-button-secondary s19-button-small" href={`/admin/reviews/${row.id}`}>Xem đánh giá</a> }]} /></section></EngagementShell>;
}

function reviewActions(status: string) {
  if (status === "HIDDEN") return ["publish", "respond"];
  if (status === "FLAGGED") return ["publish", "respond"];
  if (status === "PUBLISHED") return ["hide", "flag", "respond"];
  return ["publish", "hide", "flag", "respond"];
}

export function ReviewDetail({ reviewId }: { reviewId: string }) {
  const resource = useBenefitResource(`/v1/reviews/${encodeURIComponent(reviewId)}`);
  const mutation = useBenefitMutation();
  const [responseText, setResponseText] = useState("");
  const review = resource.data?.review ?? resource.data ?? {};
  async function action(name: string) {
    const path = `/v1/reviews/${encodeURIComponent(reviewId)}/${name}`;
    const body = name === "respond" ? { responseText: responseText.trim() } : { version: review.version, reason: "Reviewed in Admin Web" };
    const result = await mutation.submit(path, body);
    if (result) { setResponseText(""); await resource.load(); }
  }
  return <EngagementShell title="Review detail"><EngagementStates resource={resource} label="chi tiết đánh giá" />{resource.state === "ready" && <><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">NỘI DUNG KHÁCH HÀNG BẤT BIẾN</p><h2>{review.customerDisplayName ?? review.customerName ?? "Đánh giá khách hàng"}</h2></div><span className="s19-status s19-status-info">{statusLabel(review.status)}</span></div><dl className="s19-definition-grid"><div><dt>Điểm đánh giá</dt><dd>{review.rating ?? "-"}/5</dd></div><div><dt>Gửi lúc</dt><dd>{formatDate(review.submittedAt ?? review.createdAt)}</dd></div><div><dt>Lịch hẹn</dt><dd>{review.appointmentId ?? "-"}</dd></div><div><dt>Hóa đơn</dt><dd>{review.invoiceId ?? "-"}</dd></div></dl><blockquote className="s19-quote">{review.content ?? review.comment ?? review.body ?? "Chưa có nội dung đánh giá."}</blockquote>{(review.verifiedEvidence ?? review.verified_evidence_json) && <p className="s19-helper">Có bằng chứng nguồn đã xác minh dành cho người có quyền xem.</p>}<VersionActions mutation={mutation} version={review.version} actions={reviewActions(String(review.status))} onAction={(name) => void action(name)} /><label className="s19-field"><span>Phản hồi (được xuất bản tách biệt với nội dung khách hàng)</span><textarea value={responseText} rows={3} onChange={(event) => setResponseText(event.target.value)} placeholder="Viết phản hồi chuyên nghiệp" /></label></section><section className="s19-card"><h2>Lịch sử phản hồi</h2><SafeTable data={rows(review.responses ?? review.responseHistory)} columns={[{ key: "responseText", label: "Phản hồi", render: (row) => row.responseText ?? row.body ?? "-" }, { key: "author", label: "Người viết", render: (row) => row.authorDisplayName ?? row.authorUserId ?? "-" }, { key: "createdAt", label: "Tạo lúc", render: (row) => formatDate(row.createdAt) }]} /></section></>}<Notice mutation={mutation} /></EngagementShell>;
}

export function ReviewRequests() {
  const resource = useBenefitResource("/v1/review-requests");
  const mutation = useBenefitMutation();
  return <EngagementShell title="Review requests"><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">LIÊN HỆ AN TOÀN THEO CONSENT</p><h2>Yêu cầu đánh giá</h2></div></div><EngagementStates resource={resource} label="yêu cầu đánh giá" /><SafeTable data={rows(resource.data)} columns={[{ key: "customer", label: "Khách hàng", render: (row) => row.customerDisplayName ?? row.customerName ?? "Khách hàng" }, { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) }, { key: "channel", label: "Kênh", render: (row) => row.channel ?? "EMAIL" }, { key: "createdAt", label: "Tạo lúc", render: (row) => formatDate(row.createdAt) }, { key: "actions", label: "Thao tác", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={["resend", ...(String(row.status).toUpperCase() === "CANCELLED" ? [] : ["cancel"])]} onAction={(name) => void mutation.submit(`/v1/review-requests/${row.id}/${name}`, { version: row.version }).then(() => resource.load())} /> }]} /></section><Notice mutation={mutation} /></EngagementShell>;
}

export function ReviewRoute({ pathname }: { pathname: string }) {
  if (pathname === "/admin/review-requests") return <ReviewRequests />;
  const detail = pathname.match(/^\/admin\/reviews\/([^/]+)$/);
  if (detail) return <ReviewDetail reviewId={detail[1] ?? ""} />;
  return <Reviews />;
}
