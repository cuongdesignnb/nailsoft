/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "../lib/session";
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
};
function pathFor(screen: string, id?: string) {
  if (screen === "upcomingAppointments")
    return "/v1/appointments?from=2026-07-01T00:00:00Z&to=2026-09-01T00:00:00Z";
  if (screen === "appointment") return `/v1/appointments/${id ?? ""}`;
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
                  <Link href={`/appointment?id=${item.id}` as never}>
                    Open assigned appointment
                  </Link>
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
