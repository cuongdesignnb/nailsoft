/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, apiFetch, getSession } from "../lib/session";
const branch = "20000000-0000-4000-8000-000000000001",
  service = "50000000-0000-4000-8000-000000000001";
const titles: Record<string, string> = {
  upcomingAppointments: "My upcoming appointments",
  appointment: "My appointment detail",
  profile: "My profile",
  branches: "My branches",
  skills: "My skills",
  shifts: "My upcoming shifts",
  leave: "My leave requests",
  createLeave: "Create leave request",
  leaveDetail: "Leave request detail",
  myCalendar: "My calendar",
  myBusy: "My busy blocks",
  myAvailability: "My availability summary",
  staffToday: "Staff Today",
  myEarnings: "My earnings",
  commissionHistory: "Commission and refund history",
  netTips: "My net tips",
  packageCoverage: "Appointment package coverage",
};
function pathFor(screen: string, id?: string) {
  if (screen === "staffToday") return "/v1/staff/me/today";
  if (screen === "myEarnings" || screen === "commissionHistory")
    return "/v1/staff/me/commissions";
  if (screen === "netTips") return "/v1/staff/me/tips";
  if (screen === "upcomingAppointments")
    return "/v1/appointments?from=2026-07-01T00:00:00Z&to=2026-09-01T00:00:00Z";
  if (screen === "appointment") return `/v1/appointments/${id ?? ""}`;
  if (screen === "packageCoverage")
    return id ? `/v1/appointments/${id}/benefits` : null;
  if (["profile", "branches", "skills", "createLeave"].includes(screen))
    return "/v1/staff/me";
  if (screen === "shifts") return "/v1/shifts";
  if (screen === "leave") return "/v1/leave-requests";
  if (screen === "leaveDetail") return `/v1/leave-requests/${id ?? ""}`;
  if (screen === "myCalendar")
    return `/v1/calendar/events?branchId=${branch}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-17T00:00:00%2B07:00`;
  if (screen === "myBusy")
    return `/v1/availability-blocks?branchId=${branch}&from=2026-08-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00`;
  if (screen === "myAvailability")
    return `/v1/availability?branchId=${branch}&serviceId=${service}&dateFrom=2026-08-10&dateTo=2026-08-10`;
  return null;
}
export default function StaffScreen() {
  const params = useLocalSearchParams<{ screen: string; id?: string }>(),
    screen = params.screen;
  const [state, setState] = useState<
      "loading" | "ready" | "empty" | "error" | "forbidden"
    >("loading"),
    [data, setData] = useState<any[]>([]),
    [reason, setReason] = useState(""),
    [noteDraft, setNoteDraft] = useState(""),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const path = pathFor(screen, params.id);
    if (!path) {
      setState("empty");
      return;
    }
    setState("loading");
    try {
      const response = await apiFetch(path);
      if (response.status === 401 || response.status === 403) {
        setState("forbidden");
        return;
      }
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Unable to load");
      const raw = body.data;
      let value = Array.isArray(raw)
        ? raw
        : (raw?.events ?? raw?.days ?? [raw]);
      const me = body.data?.id;
      if (me && (screen === "branches" || screen === "skills")) {
        const related = await apiFetch(`/v1/staff/${me}/${screen}`),
          relatedBody = await related.json();
        if (!related.ok)
          throw new Error(relatedBody.error?.message ?? "Unable to load");
        value = Array.isArray(relatedBody.data)
          ? relatedBody.data
          : [relatedBody.data];
      }
      setData(value.filter(Boolean));
      setState(value.filter(Boolean).length ? "ready" : "empty");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load");
      setState("error");
    }
  }, [screen, params.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      ![
        "staffToday",
        "myEarnings",
        "commissionHistory",
        "netTips",
        "packageCoverage",
      ].includes(screen)
    )
      return;
    const token = getSession().accessToken;
    if (!token) return;
    const socket = io(`${api}/scheduling`, {
      auth: { token },
      transports: ["websocket"],
    });
    [
      "service_session.updated",
      "appointment.updated",
      "operations.invalidated",
      "commission.updated",
      "refund.updated",
      "package.updated",
      "benefits.wallet_invalidated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load, screen]);
  async function createLeave() {
    const body = {
        staffId: data[0]?.id,
        branchId: data[0]?.branchId,
        leaveType: "PERSONAL",
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 3600000).toISOString(),
        reason,
      },
      response = await apiFetch("/v1/leave-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `leave-${Date.now()}`,
        },
        body: JSON.stringify(body),
      });
    setMessage(
      response.ok
        ? "Leave request created."
        : "Internet connection required. The request was not queued.",
    );
  }
  async function sessionCommand(
    action: "start" | "pause" | "resume" | "complete",
  ) {
    if (!navigator.onLine) {
      setMessage("Internet connection required. The command was not queued.");
      return;
    }
    const today = data[0],
      session = today?.currentService ?? today?.nextAppointment;
    if (!session) return;
    const payload =
      action === "start" || action === "resume"
        ? { version: session.version, staffId: today.staffId }
        : action === "pause"
          ? { version: session.version, reasonCode: "CUSTOMER_BREAK" }
          : { version: session.version };
    const response = await apiFetch(
      `/v1/service-sessions/${session.id}/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      },
    );
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok
        ? `${action} completed.`
        : (body.error?.message ?? "Command failed. Retry safely."),
    );
    await load();
  }
  async function saveDraft(value: string) {
    setNoteDraft(value);
    await SecureStore.setItemAsync(
      `session-note-draft-${data[0]?.staffId}`,
      value,
    );
    setMessage("Draft saved locally; it is not synced.");
  }
  async function syncNote() {
    const today = data[0],
      session = today?.currentService ?? today?.nextAppointment;
    if (!session || !noteDraft) return;
    if (!navigator.onLine) {
      setMessage("Internet connection required. Draft remains local.");
      return;
    }
    const response = await apiFetch(
      `/v1/service-sessions/${session.id}/notes`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ visibility: "TECHNICIAN", note: noteDraft }),
      },
    );
    setMessage(response.ok ? "Note synced." : "Note not synced; retry safely.");
    if (response.ok) {
      setNoteDraft("");
      await SecureStore.deleteItemAsync(`session-note-draft-${today.staffId}`);
    }
  }
  async function mediaAvailability() {
    const today = data[0],
      session = today?.currentService ?? today?.nextAppointment;
    if (!session) return;
    if (!navigator.onLine) {
      setMessage(
        "Internet connection required. Photo metadata remains pending.",
      );
      return;
    }
    const response = await apiFetch(
      `/v1/service-sessions/${session.id}/media/presign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          mediaType: "BEFORE",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          checksum: "0".repeat(64),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setMessage(
      response.ok && body.data?.enabled !== false
        ? "Secure photo upload is available."
        : `Photo upload unavailable: ${body.data?.reason ?? body.error?.message ?? "retry"}`,
    );
  }
  return (
    <SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ color: "#6D28D9", fontWeight: "700" }}>
          STAFF · SPRINT 4
        </Text>
        <Text style={{ fontSize: 30, fontWeight: "700" }}>
          {titles[screen] ?? "Workspace"}
        </Text>
        {message && <Text accessibilityRole="alert">{message}</Text>}
        {state === "loading" && (
          <ActivityIndicator accessibilityLabel="Loading" />
        )}
        {state === "forbidden" && (
          <Text accessibilityRole="alert">
            Permission denied. Only your assigned appointments are visible.
          </Text>
        )}
        {state === "error" && (
          <View>
            <Text accessibilityRole="alert">{message}</Text>
            <Button title="Retry" onPress={() => void load()} />
          </View>
        )}
        {state === "empty" && (
          <View>
            <Text>No records are available.</Text>
            <Button title="Refresh" onPress={() => void load()} />
          </View>
        )}
        {state === "ready" && (
          <View style={{ gap: 12 }}>
            {data.map((item, index) => (
              <View
                key={item.id ?? index}
                style={{
                  padding: 16,
                  backgroundColor: "#F3EEFF",
                  borderRadius: 12,
                  gap: 6,
                }}
              >
                <Text style={{ fontWeight: "700" }}>
                  {item.bookingReference ??
                    item.displayName ??
                    item.code ??
                    item.status ??
                    item.id}
                </Text>
                <Text>
                  {item.startAt
                    ? `${item.startAt} – ${item.endAt}`
                    : (item.status ?? "Active")}
                </Text>
                {screen === "upcomingAppointments" && item.id && (
                  <View style={{ gap: 6 }}>
                    <Link href={`/appointment?id=${item.id}` as never}>
                      Open assigned appointment
                    </Link>
                    <Link href={`/packageCoverage?id=${item.id}` as never}>
                      View package coverage
                    </Link>
                  </View>
                )}
                {screen === "leave" && item.id && (
                  <Link href={`/leaveDetail?id=${item.id}` as never}>
                    Open detail
                  </Link>
                )}
              </View>
            ))}
          </View>
        )}
        {screen === "appointment" && data[0] && (
          <View
            style={{
              padding: 16,
              backgroundColor: "#F3EEFF",
              borderRadius: 12,
              gap: 8,
            }}
          >
            <Text style={{ fontWeight: "700" }}>
              Customer: {data[0].contact?.displayName}
            </Text>
            <Text>
              {data[0].items
                ?.map(
                  (item: any) =>
                    item.service?.name?.["vi-VN"] ?? item.service?.code,
                )
                .join(", ")}
            </Text>
            <Text>
              {data[0].startAt} – {data[0].endAt}
            </Text>
            <Text>Branch: {data[0].branchId}</Text>
            <Text>Customer note: {data[0].customerNote || "None"}</Text>
            <Text>
              Schedule changes are refreshed from authoritative realtime
              invalidations.
            </Text>
          </View>
        )}
        {screen === "staffToday" && data[0] && (
          <View style={{ gap: 12 }}>
            <View
              style={{
                padding: 16,
                backgroundColor: "#F3EEFF",
                borderRadius: 12,
                gap: 6,
              }}
            >
              <Text style={{ fontWeight: "700" }}>Current service</Text>
              <Text>
                {data[0].currentService?.customerDisplayName ??
                  "No active service"}
              </Text>
              <Text>{data[0].currentService?.status ?? "Available"}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {!data[0].currentService && data[0].nextAppointment && (
                <Button
                  title="Start"
                  onPress={() => void sessionCommand("start")}
                />
              )}
              {data[0].currentService?.status === "IN_PROGRESS" && (
                <Button
                  title="Pause"
                  onPress={() => void sessionCommand("pause")}
                />
              )}
              {data[0].currentService?.status === "PAUSED" && (
                <Button
                  title="Resume"
                  onPress={() => void sessionCommand("resume")}
                />
              )}
              {data[0].currentService && (
                <Button
                  title="Complete"
                  onPress={() => void sessionCommand("complete")}
                />
              )}
            </View>
            <TextInput
              placeholder="Private note draft"
              value={noteDraft}
              onChangeText={(value) => void saveDraft(value)}
              style={{ borderWidth: 1, padding: 12 }}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Sync note" onPress={() => void syncNote()} />
              <Button
                title="Add photo"
                onPress={() => void mediaAvailability()}
              />
            </View>
            <Text>
              Upcoming: {data[0].upcomingServices?.length ?? 0} · Completed
              today: {data[0].completedToday?.length ?? 0}
            </Text>
            <Text>
              Start, pause, resume, complete and transfer require internet.
            </Text>
          </View>
        )}
        {screen === "createLeave" && (
          <View style={{ gap: 10 }}>
            <TextInput
              placeholder="Reason"
              value={reason}
              onChangeText={setReason}
              style={{ borderWidth: 1, padding: 12 }}
            />
            <Button
              title="Create leave request"
              onPress={() => void createLeave()}
            />
          </View>
        )}
        <Link href="/">Back to home</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
