/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { api, apiFetch, getSession } from "../lib/session";

const branch = "20000000-0000-4000-8000-000000000001",
  service = "50000000-0000-4000-8000-000000000001";
const titles: Record<string, string> = {
  appointmentsToday: "Appointments today",
  appointments: "Appointment list",
  appointment: "Appointment detail",
  organization: "Organization summary",
  branches: "Branch list",
  team: "Team list",
  sessions: "Active sessions",
  profile: "Profile",
  services: "Service summary",
  service: "Service detail",
  staff: "Staff list",
  staffDetail: "Staff detail",
  shifts: "Shift summary",
  leave: "Pending leave requests",
  leaveReview: "Review leave request",
  calendarDay: "Calendar day",
  calendarWeek: "Calendar week",
  availability: "Availability",
  explain: "Availability explain",
  blocks: "Busy blocks",
  createBlock: "Create manual block",
  operationalSummary: "Operational summary",
  walkInQueue: "Walk-in queue",
  financialSummary: "Today financial summary",
};
function endpoint(screen: string, id?: string) {
  if (screen === "operationalSummary")
    return `/v1/operations/summary?branchId=${branch}`;
  if (screen === "walkInQueue") return `/v1/walk-ins?branchId=${branch}`;
  if (screen === "financialSummary")
    return `/v1/financial/summary?branchId=${branch}`;
  if (screen === "appointmentsToday")
    return `/v1/appointments?branchId=${branch}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`;
  if (screen === "appointments")
    return `/v1/appointments?branchId=${branch}&from=2026-07-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00`;
  if (screen === "appointment") return `/v1/appointments/${id ?? ""}`;
  if (screen === "services")
    return "/v1/services?status=ACTIVE&page=1&pageSize=50";
  if (screen === "service") return `/v1/services/${id ?? ""}`;
  if (screen === "staff") return "/v1/staff?status=ACTIVE";
  if (screen === "staffDetail") return `/v1/staff/${id ?? ""}`;
  if (screen === "shifts") return "/v1/shifts";
  if (screen === "leave") return "/v1/leave-requests?status=PENDING";
  if (screen === "leaveReview") return `/v1/leave-requests/${id ?? ""}`;
  if (screen === "calendarDay")
    return `/v1/calendar/events?branchId=${branch}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-11T00:00:00%2B07:00`;
  if (screen === "calendarWeek")
    return `/v1/calendar/summary?branchId=${branch}&from=2026-08-10T00:00:00%2B07:00&to=2026-08-17T00:00:00%2B07:00`;
  if (screen === "availability" || screen === "explain")
    return `/v1/availability?branchId=${branch}&serviceId=${service}&dateFrom=2026-08-10&dateTo=2026-08-10`;
  if (screen === "blocks" || screen === "createBlock")
    return `/v1/availability-blocks?branchId=${branch}&from=2026-08-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00`;
  if (screen === "organization") return "/v1/organization";
  if (screen === "branches") return "/v1/branches";
  if (screen === "team") return "/v1/users";
  if (screen === "sessions") return "/v1/auth/sessions";
  return null;
}

export default function OwnerScreen() {
  const params = useLocalSearchParams<{ screen: string; id?: string }>(),
    screen = params.screen;
  const [state, setState] = useState<
      "loading" | "ready" | "empty" | "error" | "forbidden"
    >("loading"),
    [data, setData] = useState<any[]>([]),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const path = endpoint(screen, params.id);
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
      const raw = body.data,
        value = Array.isArray(raw) ? raw : (raw?.events ?? raw?.days ?? [raw]);
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
      !["operationalSummary", "walkInQueue", "financialSummary"].includes(
        screen,
      )
    )
      return;
    const token = getSession().accessToken;
    if (!token) return;
    const socket = io(`${api}/scheduling`, {
      auth: { token },
      transports: ["websocket"],
    });
    [
      "operations.invalidated",
      "walkin.updated",
      "appointment.updated",
      "pos.order.updated",
      "cash_session.updated",
    ].forEach((event) => socket.on(event, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load, screen]);
  async function review(action: "approve" | "reject") {
    if (!params.id) return;
    const response = await apiFetch(
      `/v1/leave-requests/${params.id}/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `${action}-${params.id}`,
        },
        body: JSON.stringify(
          action === "reject" ? { reviewNote: "Reviewed in Owner Mobile" } : {},
        ),
      },
    );
    setMessage(
      response.ok ? `Leave ${action}d.` : "The request could not be completed.",
    );
    await load();
  }
  async function bookingCommand(
    action: "confirm" | "cancel" | "waive-deposit",
  ) {
    const current = data[0];
    if (!current) return;
    setMessage("");
    try {
      const payload =
        action === "confirm"
          ? { version: current.version }
          : action === "cancel"
            ? { version: current.version, reasonCode: "CUSTOMER_REQUEST" }
            : { version: current.version, reason: "Approved by salon owner" };
      const response = await apiFetch(
          `/v1/appointments/${current.id}/${action}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
            body: JSON.stringify(payload),
          },
        ),
        body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          body.error?.code === "BOOKING_VERSION_CONFLICT"
            ? "Version conflict. Refresh before retrying."
            : (body.error?.message ?? "Internet connection required"),
        );
      setMessage("Booking command completed.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Internet connection required",
      );
    }
  }
  return (
    <SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ color: "#6D28D9", fontWeight: "700" }}>
          OWNER · SPRINT 6
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
            Permission denied for this workspace.
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
                    item.name?.["vi-VN"] ??
                    item.status ??
                    item.id}
                </Text>
                <Text>
                  {item.startAt
                    ? `${item.startAt} – ${item.endAt}`
                    : (item.status ?? "Active")}
                </Text>
                {(screen === "appointments" ||
                  screen === "appointmentsToday") &&
                  item.id && (
                    <Link href={`/appointment?id=${item.id}` as never}>
                      Open appointment
                    </Link>
                  )}
                {screen === "leave" && item.id && (
                  <Link href={`/leaveReview?id=${item.id}` as never}>
                    Review request
                  </Link>
                )}
              </View>
            ))}
          </View>
        )}
        {screen === "appointment" && data[0] && (
          <View style={{ gap: 10 }}>
            <Text>Customer: {data[0].contact?.displayName}</Text>
            <Text>
              Services:{" "}
              {data[0].items
                ?.map(
                  (item: any) =>
                    item.service?.name?.["vi-VN"] ?? item.service?.code,
                )
                .join(", ")}
            </Text>
            {data[0].status === "PENDING_CONFIRMATION" && (
              <Button
                title="Confirm"
                onPress={() => void bookingCommand("confirm")}
              />
            )}{" "}
            {data[0].status === "PENDING_DEPOSIT" && (
              <Button
                title="Waive deposit"
                onPress={() => void bookingCommand("waive-deposit")}
              />
            )}{" "}
            {!String(data[0].status).startsWith("CANCELLED") && (
              <Button
                title="Cancel"
                onPress={() => void bookingCommand("cancel")}
              />
            )}
            <Text>
              Reschedule uses a review flow; the old schedule remains until the
              server confirms.
            </Text>
          </View>
        )}
        {screen === "operationalSummary" && data[0] && (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 22, fontWeight: "700" }}>Today now</Text>
            <Text>Waiting: {data[0].waitingCount}</Text>
            <Text>In service: {data[0].inServiceCount}</Text>
            <Text>Ready checkout: {data[0].readyCheckoutCount}</Text>
            <Text>Current delays: {data[0].currentDelayCount}</Text>
            <Text>
              Active staff:{" "}
              {data[0].staffUtilization?.activeStaffIds?.length ?? 0}
            </Text>
            <Text>
              Live updates are refetch signals; server data remains
              authoritative.
            </Text>
          </View>
        )}
        {screen === "financialSummary" && data[0]?.totals && (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 22, fontWeight: "700" }}>Today sales</Text>
            <Text>Sales: {data[0].totals.todaySalesMinor} minor units</Text>
            <Text>Paid orders: {data[0].totals.paidOrders}</Text>
            <Text>Tips: {data[0].totals.tipsMinor} minor units</Text>
            <Text>Open cash sessions: {data[0].totals.openCashSessions}</Text>
            <Text>
              Cash variance: {data[0].totals.cashVarianceMinor} minor units
            </Text>
            <Text>Partial orders: {data[0].totals.partialOrders}</Text>
            <Text>
              Read-only. Payment capture is unavailable on Owner Mobile.
            </Text>
          </View>
        )}
        {screen === "leaveReview" && params.id && (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button title="Approve" onPress={() => void review("approve")} />
            <Button title="Reject" onPress={() => void review("reject")} />
          </View>
        )}
        <Link href="/">Back to home</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
