import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { io } from "socket.io-client";
import { useQuery } from "@tanstack/react-query";
import { NativeButton, NativeStatePanel } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { api, apiFetch, getAuthContext, getSession } from "../lib/session";
import { getActiveBranchId, getOwnerBranchContext, selectActiveBranch, syncBranchContext } from "../lib/wave8/branch-context";
import { accessModeAllowsRoute, canReadRoute, routeDescriptor } from "../lib/wave8/permissions";
import { useIntentKey } from "../lib/wave8/intent-key";
import { displayRecordValue, safeRecord } from "../lib/wave8/privacy";
import { formatMinor } from "../lib/wave8/formatters";
import { logoutOwner } from "../lib/wave8/auth-flow";
import { useQueryClient } from "@tanstack/react-query";

const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
const monthAhead = () => new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);

export function endpoint(screen: string, id?: string, branchId?: string, serviceId?: string) {
  const branch = branchId ? `branchId=${encodeURIComponent(branchId)}` : "";
  if (screen === "analyticsOverview") return "/v1/analytics/command-center";
  if (screen === "analyticsBranches") return "/v1/analytics/branches/compare";
  if (screen === "analyticsAlerts") return "/v1/analytics/alerts";
  if (screen === "assetSummary") return "/v1/assets/reports/net-book-value";
  if (screen === "assetApprovals") return "/v1/assets/capitalization-requests";
  if (screen === "assetMaintenance") return "/v1/assets/reports/maintenance-due";
  if (screen === "assetTransfers") return "/v1/assets/transfers";
  if (screen === "assetDisposals") return "/v1/assets/disposals";
  if (screen === "billingPlan" || screen === "billingWarnings") return "/v1/tenant/billing/subscription";
  if (screen === "billingQuotas") return "/v1/tenant/billing/entitlements";
  if (screen === "billingInvoices") return "/v1/tenant/billing/invoices";
  if (screen === "supportAccess") return "/v1/tenant/support-access-grants";
  if (screen === "procurementVendors") return "/v1/procurement/vendors";
  if (screen === "procurementRequests") return "/v1/procurement/purchase-requests";
  if (screen === "procurementOrders") return "/v1/procurement/purchase-orders";
  if (screen === "procurementBills") return "/v1/procurement/vendor-bills";
  if (screen === "procurementAp") return "/v1/procurement/ap/open-items";
  if (screen === "procurementPayments") return "/v1/procurement/vendor-payments";
  if (screen === "attendanceSummary") return "/v1/workforce/reports/attendance";
  if (screen === "missingPunchAlerts") return "/v1/time-clock/exceptions";
  if (screen === "timesheetApprovals") return "/v1/timesheets";
  if (screen === "payrollApprovals") return "/v1/payroll/runs";
  if (screen === "payoutApprovals") return "/v1/payout-batches";
  if (screen === "payrollFailures") return "/v1/payroll/reports/exceptions";
  if (screen === "operationalSummary") return `/v1/operations/summary?${branch}`;
  if (screen === "walkInQueue") return `/v1/walk-ins?${branch}`;
  if (screen === "financialSummary") return `/v1/financial/summary?${branch}`;
  if (screen === "pendingRefunds") return branchId ? `/v1/refunds?branchId=${encodeURIComponent(branchId)}&status=PENDING_APPROVAL` : null;
  if (screen === "refundTotals") return branchId ? `/v1/financial/refunds?branchId=${encodeURIComponent(branchId)}` : null;
  if (screen === "commissionPeriods" || screen === "commissionReadiness") return "/v1/commission-periods";
  if (screen === "benefitSummary" || screen === "benefitLiability") return "/v1/benefits/reports/liability";
  if (screen === "voucherUsage") return "/v1/benefits/reports/vouchers";
  if (screen === "membershipCounts") return "/v1/benefits/reports/membership";
  if (screen === "pendingLoyaltyAdjustments") return "/v1/loyalty-adjustments";
  if (screen === "expiringBenefits") return "/v1/benefits/reports/expiring";
  if (screen === "inventoryLowStock" || screen === "inventoryExpiry") return `/v1/inventory/alerts?${branch}`;
  if (screen === "inventoryApprovals") return `/v1/inventory/purchase-orders?${branch}`;
  if (screen === "inventoryVariances") return `/v1/inventory/adjustments?${branch}`;
  if (screen === "inventoryValuation") return `/v1/inventory/reports/valuation?${branch}`;
  if (screen === "storedValueLiability") return "/v1/stored-value/reports/liability";
  if (screen === "storedValueIssuance") return "/v1/stored-value/reports/issuance";
  if (screen === "storedValueRedemption") return "/v1/stored-value/reports/redemption";
  if (screen === "customerCreditOutstanding") return "/v1/stored-value/reports/customer-credit";
  if (screen === "storedValueApprovals") return "/v1/stored-value-adjustments";
  if (screen === "storedValueExceptions") return "/v1/stored-value/reports/exceptions";
  if (screen === "campaignApprovals") return "/v1/marketing-campaigns";
  if (screen === "compensationApprovals") return "/v1/service-recovery/compensations";
  if (["lowRatingAlerts", "recoverySla"].includes(screen)) return "/v1/service-recovery/cases";
  if (screen === "appointmentsToday") return `/v1/appointments?${branch}&from=${today()}T00:00:00&to=${tomorrow()}T00:00:00`;
  if (screen === "appointments") return `/v1/appointments?${branch}&from=${monthAgo()}T00:00:00&to=${monthAhead()}T00:00:00`;
  if (screen === "appointment") return `/v1/appointments/${encodeURIComponent(id ?? "")}`;
  if (screen === "services") return "/v1/services?status=ACTIVE&page=1&pageSize=50";
  if (screen === "service") return `/v1/services/${encodeURIComponent(id ?? "")}`;
  if (screen === "staff") return "/v1/staff?status=ACTIVE";
  if (screen === "staffDetail") return `/v1/staff/${encodeURIComponent(id ?? "")}`;
  if (screen === "shifts") return "/v1/shifts";
  if (screen === "leave") return "/v1/leave-requests?status=PENDING";
  if (screen === "leaveReview") return `/v1/leave-requests/${encodeURIComponent(id ?? "")}`;
  if (screen === "calendarDay") return `/v1/calendar/events?${branch}&from=${today()}T00:00:00&to=${tomorrow()}T00:00:00`;
  if (screen === "calendarWeek") return `/v1/calendar/summary?${branch}&from=${today()}T00:00:00&to=${monthAhead()}T00:00:00`;
  if (screen === "availability" || screen === "explain") return branchId && serviceId ? `/v1/availability?${branch}&serviceId=${encodeURIComponent(serviceId)}&dateFrom=${today()}&dateTo=${today()}` : null;
  if (screen === "blocks" || screen === "createBlock") return `/v1/availability-blocks?${branch}&from=${monthAgo()}T00:00:00&to=${monthAhead()}T00:00:00`;
  if (screen === "organization") return "/v1/organization";
  if (screen === "branches") return "/v1/branches";
  if (screen === "team") return "/v1/users";
  if (screen === "sessions") return "/v1/auth/sessions";
  if (screen === "profile" || screen === "workspace" || screen === "mfa") return "/v1/auth/context";
  return null;
}

type JsonObject = Record<string, unknown>;
function asObject(value: unknown): JsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function toRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(asObject).filter((row): row is JsonObject => !!row);
  const object = asObject(value);
  if (!object) return [];
  for (const key of ["rows", "events", "days", "items", "data"]) if (Array.isArray(object[key])) return object[key].map(asObject).filter((row): row is JsonObject => !!row);
  return [object];
}
function stringValue(row: JsonObject, key: string) { const value = row[key]; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }

function BranchPicker({ onChanged }: { onChanged: () => void }) {
  const branchContext = getOwnerBranchContext();
  if (branchContext.authorizedBranches.length <= 1) return null;
  return <View style={styles.branchBox}><Text style={styles.label}>Branch</Text><Text style={styles.copy}>{branchContext.activeBranchId ? branchContext.authorizedBranches.find((branch) => branch.id === branchContext.activeBranchId)?.name : "All authorized branches"}</Text><View style={styles.branchOptions}><NativeButton label="All authorized branches" variant={!branchContext.activeBranchId ? "primary" : "secondary"} onPress={() => { selectActiveBranch(undefined); onChanged(); }} />{branchContext.authorizedBranches.map((branch) => <NativeButton key={branch.id} label={branch.name} variant={branch.id === branchContext.activeBranchId ? "primary" : "secondary"} onPress={() => { selectActiveBranch(branch.id); onChanged(); }} />)}</View></View>;
}

function StableCommandButton({ domain, entityId, action, label, path, body, onComplete, allowWrites = true }: { domain: string; entityId: string; action: string; label: string; path: string; body?: JsonObject; onComplete: (message: string) => void; allowWrites?: boolean }) {
  const intent = useIntentKey(domain, entityId, action);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { onComplete(domain === "support" ? "Support decisions are not queued while offline." : "Internet connection required. Approval was not queued."); return; }
    setBusy(true);
    try {
      const response = await apiFetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": intent.key }, body: JSON.stringify(body ?? {}) });
      const payload = await response.json().catch(() => ({} as { error?: { code?: string; message?: string } }));
      if (response.status === 409 || payload.error?.code?.includes("CONFLICT")) { onComplete("This record changed since you opened it. Refresh before deciding again."); return; }
      onComplete(response.ok ? `${label} completed.` : payload.error?.message ?? "Command failed safely.");
      if (response.ok) intent.reset();
    } finally { setBusy(false); }
  }
  return <NativeButton label={label} disabled={busy || !allowWrites} onPress={() => void run()} />;
}

export default function OwnerScreen() {
  const params = useLocalSearchParams<{ screen?: string | string[]; id?: string | string[]; serviceId?: string | string[] }>();
  const screen = Array.isArray(params.screen) ? params.screen[0] ?? "" : params.screen ?? "";
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const serviceId = Array.isArray(params.serviceId) ? params.serviceId[0] : params.serviceId;
  const route = routeDescriptor(screen);
  const contextQuery = useQuery({ queryKey: ["owner-auth-context", "screen"], queryFn: getAuthContext, staleTime: 30_000 });
  const context = contextQuery.data;
  const [, setBranchVersion] = useState(0);
  const branchId = getActiveBranchId();
  const path = endpoint(screen, id, branchId, serviceId);
  const permitted = !!context && !!route && canReadRoute(context, screen) && accessModeAllowsRoute(context.workspace.accessMode, route);
  const allowWrites = !!context && (context.workspace.accessMode === "FULL" || context.workspace.accessMode === "GRACE") && !!route?.writePermissions?.length && route.writePermissions.some((permission) => context.authorization.permissions.includes(permission));
  const needsBranch = route?.scope === "BRANCH_REQUIRED";
  const query = useQuery({ queryKey: ["owner-screen", screen, id, branchId, serviceId], queryFn: async () => { const response = await apiFetch(path as string); const body = await response.json().catch(() => ({} as { error?: { message?: string }; data?: unknown })); if (response.status === 401 || response.status === 403) throw new Error("Permission denied for this workspace."); if (!response.ok) throw new Error(body.error?.message ?? "Unable to load"); return body.data; }, enabled: !!context && permitted && !!path && (!needsBranch || !!branchId), staleTime: 30_000 });
  const [message, setMessage] = useState("");
  const load = useCallback(() => { void query.refetch(); }, [query]);
  useEffect(() => { if (context) { syncBranchContext(context); setBranchVersion((value) => value + 1); } }, [context]);
  useEffect(() => {
    if (!path || !permitted) return;
    const token = getSession().accessToken;
    if (!token) return;
    const excluded = ["operationalSummary", "walkInQueue", "financialSummary", "benefitSummary", "benefitLiability", "voucherUsage", "membershipCounts", "pendingLoyaltyAdjustments", "expiringBenefits", "inventoryLowStock", "inventoryExpiry", "inventoryApprovals", "inventoryVariances", "inventoryValuation", "storedValueLiability", "storedValueIssuance", "storedValueRedemption", "customerCreditOutstanding", "storedValueApprovals", "storedValueExceptions", "billingPlan", "billingQuotas", "billingInvoices", "billingWarnings", "supportAccess", "procurementVendors", "procurementRequests", "procurementOrders", "procurementBills", "procurementAp", "procurementPayments"];
    if (excluded.includes(screen)) return;
    const socket = io(`${api}/scheduling`, { auth: { token }, transports: ["websocket"] });
    const events = ["operations.invalidated", "walkin.updated", "appointment.updated", "pos.order.updated", "cash_session.updated", "refund.updated", "credit_note.updated", "commission.updated", "financial.updated", "voucher.updated", "loyalty.updated", "membership.updated", "package.updated", "benefits.wallet_invalidated", "gift_card.updated", "customer_credit.updated", "stored_value.wallet_invalidated", "stored_value.liability_invalidated", "stored_value.reconciliation_invalidated"];
    events.forEach((event) => socket.on(event, () => void query.refetch()));
    socket.on("connect", () => void query.refetch());
    socket.on("reconnect", () => void query.refetch());
    return () => { socket.disconnect(); };
  }, [path, permitted, query, screen]);

  if (contextQuery.isPending) return <Page><NativeStatePanel state="loading" title="Loading" /></Page>;
  if (contextQuery.isError || !context) return <Page><NativeStatePanel state="error" title="Unable to load workspace" detail="Check the connection and retry." onRetry={() => void contextQuery.refetch()} /></Page>;
  if (!route || !permitted) return <Page><Text accessibilityRole="alert">Permission denied for this workspace.</Text><Link href="/">Back to home</Link></Page>;
  if (screen === "profile") return <ProfileSettings context={context} />;
  if (needsBranch && !branchId) return <Page><BranchPicker onChanged={() => setBranchVersion((value) => value + 1)} /><NativeStatePanel state="empty" title="Select an authorized branch" detail="A branch is required for this screen." /></Page>;
  const rows = toRows(query.data);
  const locale = context.user.locale;
  return <Page><BranchPicker onChanged={() => { setBranchVersion((value) => value + 1); void query.refetch(); }} /><Text accessibilityRole="header" style={styles.title}>{screen}</Text>{message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}{query.isPending && <ActivityIndicator accessibilityLabel="Loading" />}{query.isError && <NativeStatePanel state="error" title="Unable to load" detail={query.error instanceof Error ? query.error.message : "Request failed safely."} onRetry={load} />}{query.isFetching && rows.length > 0 ? <Text style={styles.stale}>Data may be stale. Refreshing...</Text> : null}{!query.isPending && !query.isError && rows.length === 0 && <View><Text>No records are available.</Text><NativeButton label="Retry" variant="secondary" icon="refresh" onPress={load} /></View>}{rows.map((raw, index) => <SafeRow key={stringValue(raw, "id") || `${screen}-${index}`} screen={screen} raw={raw} locale={locale} id={stringValue(raw, "id")} onMessage={setMessage} allowWrites={allowWrites} />)}<Link href="/">Back to home</Link></Page>;
}

function Page({ children }: { children: React.ReactNode }) { return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }

function ProfileSettings({ context }: { context: import("@nailsoft/domain-types").AuthContext }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["owner-sessions"], queryFn: () => apiFetch("/v1/auth/sessions").then(async (response) => { const body = await response.json().catch(() => ({} as { data?: unknown })); if (!response.ok) throw new Error("Unable to load sessions"); return toRows(body.data); }) });
  const mfa = useQuery({ queryKey: ["owner-mfa-status"], queryFn: () => apiFetch("/v1/auth/mfa/status").then(async (response) => { const body = await response.json().catch(() => ({} as { data?: unknown })); if (!response.ok) throw new Error("Unable to load MFA status"); return asObject(body.data) ?? {}; }) });
  async function logout() { await logoutOwner(); queryClient.clear(); router.replace("/"); }
  return <Page><Text accessibilityRole="header" style={styles.title}>Profile</Text><View style={styles.card}><Text style={styles.cardTitle}>{context.user.displayName}</Text><Text style={styles.copy}>{context.workspace.tenantName}</Text><Text style={styles.copy}>Locale: {context.user.locale}</Text><Text style={styles.copy}>Access mode: {context.workspace.accessMode}</Text><Text style={styles.copy}>Owner Mobile: {context.capabilities?.ownerMobileEnabled ? "Enabled" : "Unavailable"}</Text><Text style={styles.copy}>MFA: {String(mfa.data?.enabled ?? "Unknown")}</Text></View><Text style={styles.title}>Active sessions</Text>{sessions.isPending ? <ActivityIndicator accessibilityLabel="Loading" /> : null}{sessions.isError ? <NativeStatePanel state="error" title="Unable to load sessions" onRetry={() => void sessions.refetch()} /> : null}{sessions.data?.map((session, index) => <SessionRow key={stringValue(session, "id") || `session-${index}`} session={session} />)}<NativeButton label="Sign out" variant="danger" icon="logout" onPress={() => void logout()} /><Link href="/">Back to home</Link></Page>;
}

function SessionRow({ session }: { session: JsonObject }) {
  const sessionId = stringValue(session, "id");
  const current = session.isCurrent === true || stringValue(session, "isCurrent") === "true";
  const intent = useIntentKey("session", sessionId, "revoke");
  const [busy, setBusy] = useState(false);
  async function revoke() {
    if (!sessionId || current) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: "POST", headers: { "idempotency-key": intent.key } });
      if (response.ok) intent.reset();
    } finally { setBusy(false); }
  }
  return <View style={styles.card}><Text style={styles.cardTitle}>{stringValue(session, "deviceName") || "Owner Mobile session"}</Text><Text style={styles.copy}>{stringValue(session, "platform")}</Text>{current ? <Text style={styles.copy}>Current session</Text> : <NativeButton label="Revoke session" variant="secondary" disabled={busy} onPress={() => void revoke()} />}</View>;
}

function SafeRow({ screen, raw, locale, id, onMessage, allowWrites }: { screen: string; raw: JsonObject; locale: "vi-VN" | "en-US"; id: string; onMessage: (value: string) => void; allowWrites: boolean }) {
  const record = safeRecord(raw);
  const status = String(record.status ?? record.state ?? "");
  const branchId = String(record.branchId ?? "");
  const version = typeof record.version === "number" ? record.version : undefined;
  const money = record.totalMinor ?? record.amountMinor ?? record.requestedMinor ?? record.completedMinor;
  const moneyValue = typeof money === "string" || typeof money === "number" ? money : undefined;
  const currency = String(record.currency ?? "VND");
  return <View style={styles.card}><Text style={styles.cardTitle}>{displayRecordValue(record)}</Text>{status ? <Text style={styles.copy}>Status: {status}</Text> : null}{branchId ? <Text style={styles.copy}>Branch: {branchId}</Text> : null}{moneyValue !== undefined ? <Text style={styles.copy}>Amount: {formatMinor(moneyValue, currency, locale)}</Text> : null}{record.startAt ? <Text style={styles.copy}>Start: {String(record.startAt)}</Text> : null}{screen === "appointment" && raw.contact && typeof raw.contact === "object" ? <Text style={styles.copy}>Customer: {String((raw.contact as JsonObject).displayName ?? "Customer")}</Text> : null}{screen === "operationalSummary" ? <OperationalSummary raw={raw} /> : null}{screen === "financialSummary" ? <FinancialSummary raw={raw} locale={locale} /> : null}{screen === "appointment" && id && (status === "PENDING_CONFIRMATION" || status === "PENDING_DEPOSIT" || !status.startsWith("CANCELLED")) ? <View style={styles.actions}>{status === "PENDING_CONFIRMATION" ? <StableCommandButton allowWrites={allowWrites} domain="booking" entityId={id} action="confirm" label="Confirm" path={`/v1/appointments/${id}/confirm`} body={{ version }} onComplete={onMessage} /> : null}{status === "PENDING_DEPOSIT" ? <StableCommandButton allowWrites={allowWrites} domain="booking" entityId={id} action="waive-deposit" label="Waive deposit" path={`/v1/appointments/${id}/waive-deposit`} body={{ version, reason: "Approved by salon owner" }} onComplete={onMessage} /> : null}{!status.startsWith("CANCELLED") ? <StableCommandButton allowWrites={allowWrites} domain="booking" entityId={id} action="cancel" label="Cancel" path={`/v1/appointments/${id}/cancel`} body={{ version, reasonCode: "CUSTOMER_REQUEST" }} onComplete={onMessage} /> : null}<Text style={styles.copy}>Version conflict requires refresh; mutations are never retried automatically.</Text></View> : null}{screen === "pendingRefunds" && id ? <View style={styles.actions}>{<StableCommandButton allowWrites={allowWrites} domain="refund" entityId={id} action="approve" label="Approve" path={`/v1/refunds/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} />}<StableCommandButton allowWrites={allowWrites} domain="refund" entityId={id} action="reject" label="Reject" path={`/v1/refunds/${id}/reject`} body={{ version, reason: "Rejected in Owner Mobile" }} onComplete={onMessage} /></View> : null}{screen === "inventoryApprovals" && id && status === "SUBMITTED" ? <StableCommandButton allowWrites={allowWrites} domain="inventory" entityId={id} action="approve" label="Approve purchase order" path={`/v1/inventory/purchase-orders/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "procurementRequests" && id && status === "SUBMITTED" ? <StableCommandButton allowWrites={allowWrites} domain="procurement" entityId={id} action="approve-request" label="Approve request" path={`/v1/procurement/purchase-requests/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "procurementPayments" && id && status === "PENDING_APPROVAL" ? <StableCommandButton allowWrites={allowWrites} domain="procurement" entityId={id} action="approve-payment" label="Approve vendor payment" path={`/v1/procurement/vendor-payments/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "campaignApprovals" && id && status === "PENDING_APPROVAL" ? <StableCommandButton allowWrites={allowWrites} domain="engagement" entityId={id} action="approve-campaign" label="Approve campaign" path={`/v1/marketing-campaigns/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} /> : null}{["lowRatingAlerts", "recoverySla"].includes(screen) && id && status === "OPEN" ? <StableCommandButton allowWrites={allowWrites} domain="recovery" entityId={id} action="triage" label="Triage recovery case" path={`/v1/service-recovery/cases/${id}/triage`} body={{ version, reason: "Reviewed in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "compensationApprovals" && id && status === "PENDING_APPROVAL" ? <View style={styles.actions}><StableCommandButton allowWrites={allowWrites} domain="recovery" entityId={id} action="approve-compensation" label="Approve compensation" path={`/v1/service-recovery/compensations/${id}/approve`} body={{ version, reason: "Approved in Owner Mobile" }} onComplete={onMessage} /><StableCommandButton allowWrites={allowWrites} domain="recovery" entityId={id} action="reject-compensation" label="Reject compensation" path={`/v1/service-recovery/compensations/${id}/reject`} body={{ version, reason: "Rejected in Owner Mobile" }} onComplete={onMessage} /></View> : null}{screen === "timesheetApprovals" && id && status === "SUBMITTED" ? <StableCommandButton allowWrites={allowWrites} domain="workforce" entityId={id} action="approve-timesheet" label="Approve timesheet" path={`/v1/timesheets/${id}/approve`} body={{ version, reason: "Independently reviewed in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "payrollApprovals" && id && status === "PENDING_APPROVAL" ? <StableCommandButton allowWrites={allowWrites} domain="workforce" entityId={id} action="approve-payroll" label="Approve payroll" path={`/v1/payroll/runs/${id}/approve`} body={{ version, reason: "Independently reviewed in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "payrollApprovals" && id && status === "APPROVED" ? <StableCommandButton allowWrites={allowWrites} domain="workforce" entityId={id} action="finalize-payroll" label="Finalize payroll" path={`/v1/payroll/runs/${id}/finalize`} body={{ version, reason: "Independently reviewed in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "payoutApprovals" && id && status === "PENDING_APPROVAL" ? <StableCommandButton allowWrites={allowWrites} domain="workforce" entityId={id} action="approve-payout" label="Approve payout" path={`/v1/payout-batches/${id}/approve`} body={{ version, reason: "Independently reviewed in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "leaveReview" && id ? <View style={styles.actions}><StableCommandButton allowWrites={allowWrites} domain="leave" entityId={id} action="approve" label="Approve" path={`/v1/leave-requests/${id}/approve`} body={{}} onComplete={onMessage} /><StableCommandButton allowWrites={allowWrites} domain="leave" entityId={id} action="reject" label="Reject" path={`/v1/leave-requests/${id}/reject`} body={{ reviewNote: "Reviewed in Owner Mobile" }} onComplete={onMessage} /></View> : null}{screen === "supportAccess" && id && status === "REQUESTED" ? <StableCommandButton allowWrites={allowWrites} domain="support" entityId={id} action="approve" label="Approve scoped support access" path={`/v1/tenant/support-access-grants/${id}/approve`} body={{ reason: "Approved by tenant Owner in Owner Mobile" }} onComplete={onMessage} /> : null}{screen === "supportAccess" && id && ["APPROVED", "ACTIVE"].includes(status) ? <StableCommandButton allowWrites={allowWrites} domain="support" entityId={id} action="revoke" label="Revoke support access" path={`/v1/tenant/support-access-grants/${id}/revoke`} body={{ reason: "Revoked by tenant Owner in Owner Mobile" }} onComplete={onMessage} /> : null}</View>;
}

function OperationalSummary({ raw }: { raw: JsonObject }) { const staff = asObject(raw.staffUtilization); return <View style={styles.metricBox}><Text style={styles.metric}>Waiting: {String(raw.waitingCount ?? "—")}</Text><Text style={styles.metric}>In service: {String(raw.inServiceCount ?? "—")}</Text><Text style={styles.metric}>Ready checkout: {String(raw.readyCheckoutCount ?? "—")}</Text><Text style={styles.metric}>Current delays: {String(raw.currentDelayCount ?? "—")}</Text><Text style={styles.copy}>Active staff: {Array.isArray(staff?.activeStaffIds) ? staff.activeStaffIds.length : "—"}</Text><Text style={styles.copy}>Live updates are refetch signals; server data remains authoritative.</Text></View>; }
function FinancialSummary({ raw, locale }: { raw: JsonObject; locale: "vi-VN" | "en-US" }) { const totals = asObject(raw.totals) ?? raw; const currency = String(totals.currency ?? "VND"); const sales = typeof totals.todaySalesMinor === "string" || typeof totals.todaySalesMinor === "number" ? totals.todaySalesMinor : undefined; const tips = typeof totals.tipsMinor === "string" || typeof totals.tipsMinor === "number" ? totals.tipsMinor : undefined; return <View style={styles.metricBox}><Text style={styles.metric}>Sales: {formatMinor(sales, currency, locale)}</Text><Text style={styles.metric}>Paid orders: {String(totals.paidOrders ?? "—")}</Text><Text style={styles.metric}>Tips: {formatMinor(tips, currency, locale)}</Text><Text style={styles.copy}>Read-only. Payment capture is unavailable on Owner Mobile.</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.canvas }, content: { padding: tokens.space[4], gap: tokens.space[4] }, title: { color: tokens.color.textPrimary, fontSize: 28, fontWeight: "700" }, label: { color: tokens.color.textSecondary, fontWeight: "700" }, copy: { color: tokens.color.textSecondary, lineHeight: 21 }, message: { color: tokens.color.actionPrimary, lineHeight: 21 }, stale: { color: tokens.color.warning ?? tokens.color.textSecondary, lineHeight: 21 }, card: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault }, cardTitle: { color: tokens.color.textPrimary, fontSize: 17, fontWeight: "700" }, actions: { gap: tokens.space[2], marginTop: tokens.space[2] }, metricBox: { gap: tokens.space[1], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: "#F2F7FA" }, metric: { color: tokens.color.textPrimary, fontWeight: "700" }, branchBox: { gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.borderDefault }, branchOptions: { gap: tokens.space[2] },
});
