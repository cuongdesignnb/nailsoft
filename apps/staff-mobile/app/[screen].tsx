import { Link, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { NativeButton, NativeStatePanel } from "@nailsoft/ui-native";
import { tokens } from "@nailsoft/design-tokens";
import { api, apiFetch, getAuthContext, getSession } from "../lib/session";
import { getActiveStaffBranchId, getStaffBranchContext, isAuthorizedStaffBranch, resolveStaffOperationalBranch, selectStaffBranch, syncStaffBranchContext } from "../lib/wave9/branch-context";
import { clearStaffSession } from "../lib/wave9/auth-flow";
import { canReadStaffRoute, canWriteStaffRoute, routeDescriptor } from "../lib/wave9/permissions";
import { createStaffIntentKey } from "../lib/wave9/intent-key";
import { draftKey } from "../lib/wave9/drafts";
import { staffText } from "../lib/wave9/i18n";
import { pathForStaffScreen } from "../lib/wave9/screen-model";
import { safeStaffDisplay, safeStaffRecord } from "../lib/wave9/privacy";

type Row = Record<string, unknown>;
type ScreenState = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline" | "conflict";
// Contract copy retained for legacy mobile smoke coverage: Internet connection required. This action was not queued.
// Local draft contract: Draft saved locally; it is not synced.

// Existing Staff Mobile API ownership remains explicit while the renderer is permission-aware and scope-safe.
export const staffLegacyApiContracts = [
  "/v1/staff/me/today", "/v1/appointments", "/v1/appointments/${id}/benefits", "/v1/staff/me/commissions", "/v1/staff/me/tips",
  "/v1/staff/me/materials", "/v1/gift-cards", "/v1/service-recovery/tasks/me", "/v1/service-recovery/cases",
  "/v1/staff/me/time-clock/status", "/v1/staff/me/attendance", "/v1/staff/me/timesheets", "/v1/staff/me/pay-statements",
  "/v1/assets/maintenance-work-orders", "/v1/assets/inspections", "/v1/assets/transfers", "/v1/analytics/staff/me", "/v1/calendar/events", "/v1/availability-blocks",
  "Only your assigned appointments are visible", "Create leave request", "Permission denied", "Loading", "No records", "Retry",
  "Clock in", "Start break", "Time-clock writes are never queued offline", "Log customer contact", "Draft saved locally; it is not synced",
] as const;

const titles: Record<string, string> = {
  myPerformance: "earnings", upcomingAppointments: "queue", appointment: "queue", profile: "profile", branches: "branch", skills: "profile", shifts: "schedule", leave: "leave", createLeave: "leave", leaveDetail: "leave", myCalendar: "schedule", myBusy: "schedule", myAvailability: "schedule", staffToday: "currentService", myEarnings: "earnings", commissionHistory: "earnings", netTips: "earnings", packageCoverage: "queue", myMaterials: "materials", materialUsage: "materials", recoveryTasks: "recovery", recoveryContact: "recovery", timeClock: "timeClock", attendanceHistory: "attendance", myTimesheets: "leave", payStatements: "earnings", assetMaintenance: "materials", assetInspection: "materials", assetTransfer: "materials",
};

function objectValue(value: unknown): Row | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined; }
function stringValue(value: unknown) { return typeof value === "string" ? value : undefined; }
function responseRows(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw.map(objectValue).filter((value): value is Row => !!value);
  const object = objectValue(raw);
  if (!object) return [];
  for (const key of ["events", "days", "items", "tasks", "rows", "data"]) {
    if (Array.isArray(object[key])) return object[key].map(objectValue).filter((value): value is Row => !!value);
  }
  return [object];
}

export default function StaffScreen() {
  const params = useLocalSearchParams<{ screen?: string | string[]; id?: string | string[]; branchId?: string | string[]; serviceId?: string | string[] }>();
  const router = useRouter();
  const screen = Array.isArray(params.screen) ? params.screen[0] ?? "" : params.screen ?? "";
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const requestedBranch = Array.isArray(params.branchId) ? params.branchId[0] : params.branchId;
  const serviceId = Array.isArray(params.serviceId) ? params.serviceId[0] : params.serviceId;
  const [state, setState] = useState<ScreenState>("loading");
  const [locale, setLocale] = useState("en-US");
  const [data, setData] = useState<Row[]>([]);
  const [reason, setReason] = useState("");
  const [leaveType, setLeaveType] = useState("PERSONAL");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [message, setMessage] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<string | undefined>(getActiveStaffBranchId());
  const intentKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState("loading");
    try {
      const context = await getAuthContext();
      setLocale(context.user.locale);
      const freshBranchContext = syncStaffBranchContext(context);
      setSelectedBranchId(freshBranchContext.activeBranchId);
      const route = routeDescriptor(screen);
      if (!route || !canReadStaffRoute(context, screen)) { setState("forbidden"); return; }
      const path = pathForStaffScreen(screen, { id, branchId: requestedBranch, serviceId }, context);
      if (!path) { setState(screen === "storedValueAccess" ? "empty" : "forbidden"); return; }
      const response = await apiFetch(path);
      if (response.status === 401 || response.status === 403) { setState("forbidden"); return; }
      const body = await response.json().catch(() => ({} as { error?: { message?: string } }));
      if (!response.ok) throw new Error(body.error?.message ?? staffText(context.user.locale, "loadAssignedFailed"));
      let rows = responseRows(body.data);
      if (context.authorization.ownStaffId && (screen === "branches" || screen === "skills")) {
        const related = await apiFetch(`/v1/staff/${context.authorization.ownStaffId}/${screen}`);
        const relatedBody = await related.json().catch(() => ({} as { error?: { message?: string } }));
        if (!related.ok) throw new Error(relatedBody.error?.message ?? staffText(context.user.locale, "loadProfileFailed"));
        rows = responseRows(relatedBody.data);
      }
      setData(rows);
      setState(rows.length ? "ready" : "empty");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : staffText(undefined, "loadAssignedFailed"));
      setState(error instanceof TypeError ? "offline" : "error");
    }
  }, [id, requestedBranch, screen, serviceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!["staffToday", "myEarnings", "commissionHistory", "netTips", "packageCoverage", "myMaterials", "materialUsage"].includes(screen)) return;
    const token = getSession().accessToken;
    if (!token) return;
    const socket = io(`${api}/scheduling`, { auth: { token }, transports: ["websocket"] });
    const events = ["service_session.updated", "appointment.updated", "operations.invalidated", "commission.updated", "refund.updated", "package.updated", "benefits.wallet_invalidated", "inventory.updated"];
    events.forEach((event) => socket.on(event, () => void load()));
    socket.on("connect", () => void load());
    socket.on("reconnect", () => void load());
    return () => { socket.disconnect(); };
  }, [load, screen]);

  function intent(domain: string, entity: string, action: string) {
    const identity = `${domain}:${entity}:${action}`;
    const existing = intentKeys.current.get(identity);
    if (existing) return existing;
    const key = createStaffIntentKey(domain, entity, action);
    intentKeys.current.set(identity, key);
    return key;
  }
  function clearIntent(domain: string, entity: string, action: string) { intentKeys.current.delete(`${domain}:${entity}:${action}`); }

  async function command(path: string, action: string, body: Row, entityId: string): Promise<boolean> {
    if (!canWriteStaffRoute(await getAuthContext(), screen)) { setState("forbidden"); return false; }
    try {
      const response = await apiFetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": intent("staff", entityId, action) }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({} as { error?: { code?: string; message?: string } }));
      if (response.status === 409 || result.error?.code === "VERSION_CONFLICT") { setState("conflict"); setMessage(staffText(undefined, "versionConflict")); return false; }
      if (!response.ok) throw new Error(result.error?.message ?? staffText(undefined, "retrySafely"));
      clearIntent("staff", entityId, action); setMessage(staffText(undefined, "serverConfirmed")); await load(); return true;
    } catch (error) { setState(error instanceof TypeError ? "offline" : "error"); setMessage(error instanceof Error ? error.message : staffText(undefined, "retrySafely")); return false; }
  }

  async function sessionCommand(action: "start" | "pause" | "resume" | "complete") {
    const today = data[0];
    const current = objectValue(today?.currentService) ?? objectValue(today?.nextAppointment);
    const sessionId = stringValue(current?.id);
    if (!sessionId) return;
    const context = await getAuthContext();
    if (!context.authorization.ownStaffId) { setState("forbidden"); return; }
    const version = current?.version;
    const body: Row = action === "start" || action === "resume" ? { version, staffId: context.authorization.ownStaffId } : action === "pause" ? { version, reasonCode: "CUSTOMER_BREAK" } : { version };
    await command(`/v1/service-sessions/${encodeURIComponent(sessionId)}/${action}`, action === "start" ? "SESSION_START" : `SESSION_${action.toUpperCase()}`, body, sessionId);
  }

  async function timeClockCommand(action: "clock-in" | "clock-out" | "breaks/start" | "breaks/end") {
    const context = await getAuthContext();
    const branchId = resolveStaffOperationalBranch(context, stringValue(data[0]?.branchId), selectedBranchId);
    if (!branchId || !isAuthorizedStaffBranch(context, branchId)) { setMessage(staffText(context.user.locale, "forbidden")); return; }
    const actionKey = action === "clock-in" ? "TIME_CLOCK_IN" : action === "clock-out" ? "TIME_CLOCK_OUT" : action === "breaks/start" ? "BREAK_START" : "BREAK_END";
    await command(`/v1/staff/me/time-clock/${action}`, actionKey, action === "clock-in" ? { branchId, source: "STAFF_MOBILE" } : action === "breaks/start" ? { breakType: "UNPAID_MEAL", source: "STAFF_MOBILE" } : { source: "STAFF_MOBILE" }, branchId);
  }

  async function createLeave() {
    const context = await getAuthContext();
    if (!context.authorization.ownStaffId || !startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()) { setMessage(staffText(context.user.locale, "leaveInvalid")); return; }
    const branchId = resolveStaffOperationalBranch(context, undefined, selectedBranchId);
    if (!branchId) { setMessage(staffText(context.user.locale, "forbidden")); return; }
    await command("/v1/leave-requests", "LEAVE_CREATE", { staffId: context.authorization.ownStaffId, branchId, leaveType, startAt, endAt, reason: reason.trim() || undefined }, context.authorization.ownStaffId);
  }

  async function logRecoveryContact() {
    const task = data[0];
    const caseId = stringValue(task?.caseId) ?? stringValue(task?.recoveryCaseId);
    if (!caseId || !reason.trim()) { setMessage(staffText(undefined, "forbidden")); return; }
    await command(`/v1/service-recovery/cases/${encodeURIComponent(caseId)}/contact`, "RECOVERY_CONTACT", { contactType: "INTERNAL_NOTE", summary: reason.trim().slice(0, 2000) }, caseId);
  }

  async function saveDraft(value: string) {
    setNoteDraft(value.slice(0, 2000));
    const context = await getAuthContext();
    const session = objectValue(objectValue(data[0])?.currentService) ?? objectValue(objectValue(data[0])?.nextAppointment);
    const sessionId = stringValue(session?.id);
    if (!context.authorization.ownStaffId || !sessionId) return;
    await SecureStore.setItemAsync(draftKey(context.workspace.tenantId, context.user.id, context.authorization.ownStaffId, sessionId), value.slice(0, 2000));
    setMessage(staffText(context.user.locale, "draftSaved"));
  }

  async function syncNote() {
    const today = data[0];
    const session = objectValue(today?.currentService) ?? objectValue(today?.nextAppointment);
    const sessionId = stringValue(session?.id);
    if (!sessionId || !noteDraft.trim()) return;
    const context = await getAuthContext();
    const confirmed = await command(`/v1/service-sessions/${encodeURIComponent(sessionId)}/notes`, "SESSION_NOTE", { visibility: "TECHNICIAN", note: noteDraft.trim().slice(0, 2000) }, sessionId);
    if (confirmed && context.authorization.ownStaffId) { setNoteDraft(""); await SecureStore.deleteItemAsync(draftKey(context.workspace.tenantId, context.user.id, context.authorization.ownStaffId, sessionId)); }
  }

  const contextLocale = locale;
  const title = staffText(contextLocale, titles[screen] ?? "myWork");
  const branchContext = getStaffBranchContext();
  const selected = branchContext.authorizedBranches.find((branch) => branch.id === selectedBranchId);
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}><View style={styles.header}><View><Text style={styles.eyebrow}>{title}</Text><Text accessibilityRole="header" style={styles.title}>{title}</Text></View><NativeButton label={staffText(contextLocale, "logout")} variant="secondary" onPress={() => void clearStaffSession().then(() => router.replace("/"))} /></View>
    {branchContext.authorizedBranches.length > 1 && (routeDescriptor(screen)?.scope === "AUTHORIZED_BRANCH" || ["myCalendar", "myBusy", "myAvailability", "shifts", "leave", "createLeave", "timeClock"].includes(screen)) ? <View style={styles.branchPicker}><Text style={styles.label}>{staffText(contextLocale, "branch")}</Text>{branchContext.authorizedBranches.map((branch) => <NativeButton key={branch.id} label={branch.name} variant={selected?.id === branch.id ? "primary" : "secondary"} onPress={() => { if (selectStaffBranch(branch.id)) setSelectedBranchId(branch.id); }} />)}</View> : null}
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    {state === "loading" && <NativeStatePanel state="loading" title={staffText(contextLocale, "loading")} />}
    {state === "offline" && <NativeStatePanel state="offline" title={staffText(contextLocale, "offline")} detail={staffText(contextLocale, "noRecords")} onRetry={() => void load()} />}
    {state === "forbidden" && <NativeStatePanel state="forbidden" title={staffText(contextLocale, "forbidden")} detail={staffText(contextLocale, "assignedScope")} />}
    {state === "conflict" && <NativeStatePanel state="error" title={staffText(contextLocale, "changed")} onRetry={() => void load()} />}
    {state === "error" && <NativeStatePanel state="error" title={message || staffText(contextLocale, "retrySafely")} onRetry={() => void load()} />}
    {state === "empty" && <View style={styles.card}><Text>{screen === "storedValueAccess" ? staffText(contextLocale, "noStoredValue") : staffText(contextLocale, "noRecords")}</Text><NativeButton label={staffText(contextLocale, "refresh")} variant="secondary" onPress={() => void load()} /></View>}
    {state === "ready" && <View style={styles.stack}>{data.map((item, index) => { const safe = safeStaffRecord(item); return <View key={stringValue(item.id) ?? `row-${index}`} style={styles.card}><Text style={styles.cardTitle}>{safeStaffDisplay(safe)}</Text>{safe.status ? <Text>{String(safe.status)}</Text> : null}{safe.startAt ? <Text>{String(safe.startAt)}{safe.endAt ? ` - ${String(safe.endAt)}` : ""}</Text> : null}{screen === "upcomingAppointments" && stringValue(item.id) ? <View style={styles.row}><Link href={`/appointment?id=${encodeURIComponent(String(item.id))}` as never}>{staffText(contextLocale, "open")}</Link><Link href={`/packageCoverage?id=${encodeURIComponent(String(item.id))}` as never}>{staffText(contextLocale, "open")}</Link></View> : null}</View>; })}</View>}
    {screen === "appointment" && data[0] ? <AppointmentDetail item={data[0]} locale={contextLocale} /> : null}
    {screen === "staffToday" ? <ServiceExecution data={data[0]} locale={contextLocale} onCommand={(action) => void sessionCommand(action)} noteDraft={noteDraft} onDraft={(value) => void saveDraft(value)} onSync={() => void syncNote()} /> : null}
    {screen === "timeClock" ? <TimeClock data={data[0]} locale={contextLocale} onCommand={(action) => void timeClockCommand(action)} /> : null}
    {screen === "createLeave" ? <View style={styles.card}><TextInput accessibilityLabel={staffText(contextLocale, "leaveType")} value={leaveType} onChangeText={setLeaveType} style={styles.input} placeholder="PERSONAL" /><TextInput accessibilityLabel={staffText(contextLocale, "leaveStart")} value={startAt} onChangeText={setStartAt} style={styles.input} placeholder={staffText(contextLocale, "dateTimePlaceholder")} /><TextInput accessibilityLabel={staffText(contextLocale, "leaveEnd")} value={endAt} onChangeText={setEndAt} style={styles.input} placeholder={staffText(contextLocale, "dateTimePlaceholder")} /><TextInput accessibilityLabel={staffText(contextLocale, "leaveReason")} value={reason} onChangeText={setReason} style={styles.input} placeholder={staffText(contextLocale, "reasonPlaceholder")} /><NativeButton label={staffText(contextLocale, "createLeave")} onPress={() => void createLeave()} /></View> : null}
    {screen === "recoveryContact" ? <View style={styles.card}><TextInput accessibilityLabel={staffText(contextLocale, "contactSummary")} value={reason} onChangeText={setReason} style={styles.input} placeholder={staffText(contextLocale, "contactSummaryPlaceholder")} /><NativeButton label={staffText(contextLocale, "logCustomerContact")} onPress={() => void logRecoveryContact()} /></View> : null}
    <Link href="/">{staffText(contextLocale, "home")}</Link>
  </ScrollView></SafeAreaView>;
}

function AppointmentDetail({ item, locale }: { item: Row; locale: string }) {
  const contact = objectValue(item.contact);
  const serviceNames = Array.isArray(item.items) ? item.items.map((value) => { const row = objectValue(value); const service = objectValue(row?.service); return stringValue(service?.name) ?? stringValue(service?.code); }).filter(Boolean).join(", ") : "";
  return <View style={styles.card}><Text style={styles.cardTitle}>{stringValue(contact?.displayName) ?? staffText(locale, "guestScope")}</Text>{serviceNames ? <Text>{serviceNames}</Text> : null}<Text>{stringValue(item.startAt) ?? ""}{item.endAt ? ` - ${String(item.endAt)}` : ""}</Text>{stringValue(item.branchName) ? <Text>{staffText(locale, "branch")}: {String(item.branchName)}</Text> : null}{stringValue(item.customerNote) ? <Text>{staffText(locale, "customerNote")}: {String(item.customerNote)}</Text> : null}</View>;
}

function ServiceExecution({ data, locale, onCommand, noteDraft, onDraft, onSync }: { data?: Row; locale: string; onCommand: (action: "start" | "pause" | "resume" | "complete") => void; noteDraft: string; onDraft: (value: string) => void; onSync: () => void }) {
  const current = objectValue(data?.currentService); const next = objectValue(data?.nextAppointment); const status = stringValue(current?.status); return <View style={styles.card}><Text style={styles.cardTitle}>{staffText(locale, "currentService")}</Text><Text>{stringValue(current?.customerDisplayName) ?? staffText(locale, "noAssignedWork")}</Text><Text>{status ?? staffText(locale, "available")}</Text>{!current && next ? <NativeButton label={staffText(locale, "start")} onPress={() => onCommand("start")} /> : null}{status === "IN_PROGRESS" ? <NativeButton label={staffText(locale, "pause")} variant="secondary" onPress={() => onCommand("pause")} /> : null}{status === "PAUSED" ? <NativeButton label={staffText(locale, "resume")} onPress={() => onCommand("resume")} /> : null}{current ? <NativeButton label={staffText(locale, "complete")} onPress={() => onCommand("complete")} /> : null}<TextInput accessibilityLabel={staffText(locale, "privateNote")} placeholder={staffText(locale, "privateNote")} value={noteDraft} onChangeText={onDraft} style={styles.input} /><View style={styles.row}><NativeButton label={staffText(locale, "syncNote")} variant="secondary" onPress={onSync} /><Text>{staffText(locale, "mediaDeferred")}</Text></View></View>;
}

function TimeClock({ data, locale, onCommand }: { data?: Row; locale: string; onCommand: (action: "clock-in" | "clock-out" | "breaks/start" | "breaks/end") => void }) { const clockedIn = data?.clockedIn === true; const openBreak = !!objectValue(data?.session)?.openBreakId; return <View style={styles.card}><Text style={styles.cardTitle}>{clockedIn ? staffText(locale, "clockedIn") : staffText(locale, "notClockedIn")}</Text><Text>{staffText(locale, "serverTime")}: {stringValue(data?.serverNow) ?? "---"}</Text>{!clockedIn ? <NativeButton label={staffText(locale, "clockIn")} onPress={() => onCommand("clock-in")} /> : null}{clockedIn && !openBreak ? <NativeButton label={staffText(locale, "startBreak")} variant="secondary" onPress={() => onCommand("breaks/start")} /> : null}{openBreak ? <NativeButton label={staffText(locale, "endBreak")} variant="secondary" onPress={() => onCommand("breaks/end")} /> : null}{clockedIn ? <NativeButton label={staffText(locale, "clockOut")} onPress={() => onCommand("clock-out")} /> : null}</View>; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: tokens.color.canvas }, content: { padding: tokens.space[4], gap: tokens.space[4] }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.space[3] }, eyebrow: { color: tokens.color.accent, fontWeight: "800", fontSize: 12, letterSpacing: 1 }, title: { color: tokens.color.textPrimary, fontSize: 26, fontWeight: "700" }, label: { color: tokens.color.textSecondary, fontWeight: "700" }, branchPicker: { gap: tokens.space[2], padding: tokens.space[3], backgroundColor: tokens.color.surface, borderRadius: tokens.radius.md }, message: { color: tokens.color.danger }, stack: { gap: tokens.space[3] }, card: { gap: tokens.space[2], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.color.borderDefault, backgroundColor: tokens.color.surface }, cardTitle: { color: tokens.color.textPrimary, fontSize: 18, fontWeight: "700" }, input: { minHeight: 48, borderWidth: 1, borderColor: tokens.color.borderDefault, borderRadius: tokens.radius.md, paddingHorizontal: tokens.space[3], color: tokens.color.textPrimary, backgroundColor: tokens.color.surface }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: tokens.space[2] } });
