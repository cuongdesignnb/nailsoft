"use client";

import { useState } from "react";
import { EngagementShell, EngagementStates, Notice, SafeTable, VersionActions, formatDate, rows, statusLabel, useBenefitMutation, useBenefitResource } from "./engagement-shared";

export function Reviews() {
  const resource = useBenefitResource("/v1/reviews");
  return <EngagementShell title="Reviews"><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">CUSTOMER VOICE</p><h2>Verified reviews</h2></div></div><EngagementStates resource={resource} label="reviews" /><SafeTable data={rows(resource.data)} columns={[{ key: "rating", label: "Rating", render: (row) => <strong aria-label={`${row.rating ?? 0} out of 5`}>{row.rating ?? "-"}/5</strong> }, { key: "customer", label: "Customer", render: (row) => row.customerDisplayName ?? row.customerName ?? "Customer" }, { key: "status", label: "Status", render: (row) => <span className="s19-status s19-status-info">{statusLabel(row.status)}</span> }, { key: "branchId", label: "Branch" }, { key: "submittedAt", label: "Submitted", render: (row) => formatDate(row.submittedAt ?? row.createdAt) }, { key: "id", label: "Open", render: (row) => <a className="s19-button s19-button-secondary s19-button-small" href={`/admin/reviews/${row.id}`}>Review</a> }]} /></section></EngagementShell>;
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
  return <EngagementShell title="Review detail"><EngagementStates resource={resource} label="review detail" />{resource.state === "ready" && <><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">IMMUTABLE CUSTOMER CONTENT</p><h2>{review.customerDisplayName ?? review.customerName ?? "Customer review"}</h2></div><span className="s19-status s19-status-info">{statusLabel(review.status)}</span></div><dl className="s19-definition-grid"><div><dt>Rating</dt><dd>{review.rating ?? "-"}/5</dd></div><div><dt>Submitted</dt><dd>{formatDate(review.submittedAt ?? review.createdAt)}</dd></div><div><dt>Appointment</dt><dd>{review.appointmentId ?? "-"}</dd></div><div><dt>Invoice</dt><dd>{review.invoiceId ?? "-"}</dd></div></dl><blockquote className="s19-quote">{review.content ?? review.comment ?? review.body ?? "No review text provided."}</blockquote>{(review.verifiedEvidence ?? review.verified_evidence_json) && <p className="s19-helper">Verified source evidence is available to authorized reviewers.</p>}<VersionActions mutation={mutation} version={review.version} actions={reviewActions(String(review.status))} onAction={(name) => void action(name)} /><label className="s19-field"><span>Response (published separately from customer text)</span><textarea value={responseText} rows={3} onChange={(event) => setResponseText(event.target.value)} placeholder="Write a professional response" /></label></section><section className="s19-card"><h2>Response history</h2><SafeTable data={rows(review.responses ?? review.responseHistory)} columns={[{ key: "responseText", label: "Response", render: (row) => row.responseText ?? row.body ?? "-" }, { key: "author", label: "Author", render: (row) => row.authorDisplayName ?? row.authorUserId ?? "-" }, { key: "createdAt", label: "Created", render: (row) => formatDate(row.createdAt) }]} /></section></>}<Notice mutation={mutation} /></EngagementShell>;
}

export function ReviewRequests() {
  const resource = useBenefitResource("/v1/review-requests");
  const mutation = useBenefitMutation();
  return <EngagementShell title="Review requests"><section className="s19-card"><div className="s19-section-heading"><div><p className="s19-eyebrow">CONSENT-SAFE OUTREACH</p><h2>Requests</h2></div></div><EngagementStates resource={resource} label="review requests" /><SafeTable data={rows(resource.data)} columns={[{ key: "customer", label: "Customer", render: (row) => row.customerDisplayName ?? row.customerName ?? "Customer" }, { key: "status", label: "Status", render: (row) => statusLabel(row.status) }, { key: "channel", label: "Channel", render: (row) => row.channel ?? "EMAIL" }, { key: "createdAt", label: "Created", render: (row) => formatDate(row.createdAt) }, { key: "actions", label: "Actions", render: (row) => <VersionActions mutation={mutation} version={row.version} actions={["resend", ...(String(row.status).toUpperCase() === "CANCELLED" ? [] : ["cancel"])]} onAction={(name) => void mutation.submit(`/v1/review-requests/${row.id}/${name}`, { version: row.version }).then(() => resource.load())} /> }]} /></section><Notice mutation={mutation} /></EngagementShell>;
}

export function ReviewRoute({ pathname }: { pathname: string }) {
  if (pathname === "/admin/review-requests") return <ReviewRequests />;
  const detail = pathname.match(/^\/admin\/reviews\/([^/]+)$/);
  if (detail) return <ReviewDetail reviewId={detail[1] ?? ""} />;
  return <Reviews />;
}
