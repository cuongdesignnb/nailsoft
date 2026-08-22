/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { Icon } from "@nailsoft/ui-web";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getAuthorizedBranchContext,
  setActiveBranchId,
} from "./auth";

type LoadState = "idle" | "loading" | "ready" | "empty" | "error" | "forbidden";
type Branch = { id: string; name: string; code?: string; timezone?: string; status: string };
type Customer = { id: string; displayName: string; phone?: string | null; email?: string | null; locale?: "vi-VN" | "en-US"; status?: string };
type Service = {
  id: string;
  code?: string;
  name?: Record<string, string> | string;
  description?: Record<string, string> | string;
  defaultDurationMin?: number;
  prepTimeMin?: number;
  cleanupTimeMin?: number;
  depositType?: string;
  depositValue?: number | string | null;
  status?: string;
};
type Staff = { id: string; displayName: string; status?: string };
type Slot = {
  startAt: string;
  endAt: string;
  localStart?: string;
  localEnd?: string;
  fingerprint: string;
  staffCandidates?: Array<{ staffId: string; displayName: string; qualificationScore?: number }>;
  priceReference?: { priceId?: string; amount?: string | number; currency?: string; source?: string };
};
type Plan = {
  timezone: string;
  startAt: string;
  endAt: string;
  availabilityDataVersion: number;
  items: Array<{
    serviceId: string;
    staffId: string;
    serviceStartAt: string;
    serviceEndAt: string;
    staffOccupancyStartAt: string;
    staffOccupancyEndAt: string;
    serviceSnapshot: {
      name?: Record<string, string> | string;
      code?: string;
      durationMin?: number;
      prepTimeMin?: number;
      cleanupTimeMin?: number;
      depositType?: string;
      depositValue?: number | string | null;
    };
    priceSnapshot: { amountMinor: number; currency: string; amount?: string | number };
    availabilityFingerprint: string;
  }>;
  total: { amountMinor: number; currency: string };
};
type CalendarEvent = { id: string; eventType: string; title?: string; startAt: string; endAt: string; localStart?: string; localEnd?: string; status?: string };
type AvailabilityReason = { code: string; count?: number };

function rows(value: any): any[] {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function readJson(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền truy cập dữ liệu này."), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể tải dữ liệu."), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

function command(path: string, body: unknown, idempotencyKey = crypto.randomUUID()) {
  return readJson(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function labelOf(value: Service | any) {
  return value?.name?.["vi-VN"] ?? value?.name?.["en-US"] ?? value?.name ?? value?.code ?? "Dịch vụ";
}

function formatMoneyMinor(value: number | string | null | undefined, currency = "VND") {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value) / 10 ** currencyMinorUnit(currency);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currencyMinorUnit(currency) }).format(amount);
}

function formatTime(value: string | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function branchLocalDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function branchOffset(date: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(`${date}T12:00:00Z`));
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (raw === "GMT") return "+00:00";
  const value = raw.replace("GMT", "");
  if (/^[+-]\d$/.test(value)) return `${value[0]}0${value.slice(1)}:00`;
  if (/^[+-]\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

function rangeForDate(date: string, timezone: string) {
  const offset = branchOffset(date, timezone);
  return { from: `${date}T00:00:00${offset}`, to: `${date}T23:59:59${offset}` };
}

function dateLabel(date: string) {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

const availabilityReasonLabels: Record<string, string> = {
  BRANCH_CLOSED: "Chi nhánh đóng cửa ngày này",
  OUTSIDE_BUSINESS_HOURS: "Ngoài giờ hoạt động của chi nhánh",
  SERVICE_INACTIVE: "Dịch vụ không còn hoạt động",
  SERVICE_NOT_AVAILABLE_AT_BRANCH: "Dịch vụ chưa có tại chi nhánh này",
  NO_ACTIVE_PRICE: "Dịch vụ chưa có bảng giá hiệu lực",
  NO_ELIGIBLE_STAFF: "Không có kỹ thuật viên đủ điều kiện",
  STAFF_NOT_ASSIGNED: "Chưa phân công kỹ thuật viên cho chi nhánh",
  STAFF_NOT_BOOKABLE: "Kỹ thuật viên không nhận lịch online",
  STAFF_SKILL_MISSING: "Kỹ thuật viên chưa đủ kỹ năng của dịch vụ",
  NO_PUBLISHED_SHIFT: "Chưa có ca làm được công bố",
  STAFF_ON_APPROVED_LEAVE: "Kỹ thuật viên đang nghỉ phép",
  STAFF_BUSY: "Kỹ thuật viên đã có lịch khác",
  STAFF_RESERVED: "Kỹ thuật viên đang được giữ chỗ",
  RESOURCE_RESERVED: "Nguồn lực phục vụ đã được giữ chỗ",
  RESOURCE_UNAVAILABLE: "Nguồn lực phục vụ không khả dụng",
  RESOURCE_CAPACITY_INSUFFICIENT: "Không đủ công suất nguồn lực phục vụ",
  RESOURCE_MAINTENANCE: "Nguồn lực đang bảo trì",
  SLOT_HELD: "Khung giờ đang được giữ chỗ",
};

function availabilityReasonLabel(code: string) {
  return availabilityReasonLabels[code] ?? "Chưa đáp ứng một điều kiện availability";
}

function errorText(error: any, fallback: string) {
  if (/failed to fetch|networkerror|network request failed/i.test(String(error?.message ?? ""))) return "Không kết nối được máy chủ API. Hãy kiểm tra API đang chạy tại cổng 3001 rồi thử lại.";
  if (error?.code === "SLOT_UNAVAILABLE" || error?.code === "STAFF_RESERVED" || error?.code === "RESOURCE_CAPACITY_INSUFFICIENT") return "Khung giờ vừa thay đổi hoặc không còn đủ nguồn lực. Hãy chọn lại slot.";
  if (error?.code === "AVAILABILITY_CHANGED" || error?.code === "BOOKING_VERSION_CONFLICT") return "Dữ liệu availability đã thay đổi. Hãy làm mới và chọn lại khung giờ.";
  return error?.message ?? fallback;
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string | undefined; children: ReactNode; className?: string }) {
  return <label className={`ns-create-field ${className}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function StateMessage({ state, error, label, retry }: { state: LoadState; error?: string; label: string; retry?: () => void }) {
  if (state === "loading") return <div className="ns-create-state ns-create-state--loading" role="status"><span className="ns-create-spinner" />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className="ns-create-state ns-create-state--error" role="alert"><strong>Không có quyền truy cập</strong><span>{error ?? `Bạn không được phép xem ${label}.`}</span>{retry ? <button type="button" onClick={retry}>Thử lại</button> : null}</div>;
  if (state === "error") return <div className="ns-create-state ns-create-state--error" role="alert"><strong>Không thể tải {label}</strong><span>{error ?? "Có lỗi xảy ra khi gọi API."}</span>{retry ? <button type="button" onClick={retry}>Thử lại</button> : null}</div>;
  if (state === "empty") return <div className="ns-create-state" role="status">Chưa có {label} phù hợp với bộ lọc hiện tại.</div>;
  return null;
}

function Card({ title, icon, action, children, className = "" }: { title: string; icon: "customer" | "calendar" | "staff" | "receipt" | "clock" | "file"; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ns-create-card ${className}`}><div className="ns-create-card__heading"><div><span className="ns-create-card__icon"><Icon name={icon} /></span><h2>{title}</h2></div>{action}</div>{children}</section>;
}

export default function CreateAppointmentPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [branch, setBranch] = useState<Branch>();
  const [pageState, setPageState] = useState<LoadState>("loading");
  const [pageError, setPageError] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [catalogState, setCatalogState] = useState<LoadState>("idle");
  const [catalogError, setCatalogError] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerSearchState, setCustomerSearchState] = useState<LoadState>("idle");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer>();
  const [customerDetail, setCustomerDetail] = useState<any>();
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ displayName: "", phone: "", email: "" });
  const [newCustomerError, setNewCustomerError] = useState("");
  const [customerMutationState, setCustomerMutationState] = useState<LoadState>("idle");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<"RECEPTION" | "OWNER_MOBILE">("RECEPTION");
  const [preferredStaffId, setPreferredStaffId] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availabilityState, setAvailabilityState] = useState<LoadState>("idle");
  const [availabilityError, setAvailabilityError] = useState("");
  const [unavailableReasons, setUnavailableReasons] = useState<AvailabilityReason[]>([]);
  const [availabilityVersion, setAvailabilityVersion] = useState<number>();
  const [selectedSlot, setSelectedSlot] = useState<Slot>();
  const [plan, setPlan] = useState<Plan>();
  const [planState, setPlanState] = useState<LoadState>("idle");
  const [planError, setPlanError] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarState, setCalendarState] = useState<LoadState>("idle");
  const [note, setNote] = useState("");
  const [mutationState, setMutationState] = useState<LoadState>("idle");
  const [mutationError, setMutationError] = useState("");
  const [pageRefresh, setPageRefresh] = useState(0);
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const customerSearchSeq = useRef(0);
  const catalogSeq = useRef(0);
  const availabilitySeq = useRef(0);
  const planSeq = useRef(0);
  const prefillApplied = useRef(false);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const customerCreateIntentKey = useRef<string | undefined>(undefined);
  const holdIntentKey = useRef<string | undefined>(undefined);
  const appointmentIntentKey = useRef<string | undefined>(undefined);

  const canCreate = permissions.includes("appointment.create") && permissions.includes("slot_hold.create");
  const canCreateCustomer = permissions.includes("customer.booking_create");
  const timezone = branch?.timezone ?? "";
  const selectedServices = useMemo(() => selectedServiceIds.map((id) => services.find((item) => item.id === id)).filter(Boolean) as Service[], [selectedServiceIds, services]);
  const filteredServices = useMemo(() => {
    const query = serviceQuery.trim().toLowerCase();
    return services.filter((item) => !selectedServiceIds.includes(item.id) && (!query || `${labelOf(item)} ${item.code ?? ""}`.toLowerCase().includes(query))).slice(0, 12);
  }, [serviceQuery, services, selectedServiceIds]);
  const resolvedStaffId = preferredStaffId || plan?.items?.[0]?.staffId || "";
  const eligibleStaff = selectedSlot?.staffCandidates ?? [];
  const resolvedStaff = staff.find((item) => item.id === resolvedStaffId) ?? eligibleStaff.find((item) => item.staffId === resolvedStaffId);
  const totalDuration = plan ? Math.round((new Date(plan.endAt).getTime() - new Date(plan.startAt).getTime()) / 60_000) : selectedServices.reduce((sum, item) => sum + Number(item.defaultDurationMin ?? 0), 0);
  const depositMinor = useMemo(() => {
    if (!plan) return undefined;
    const unit = currencyMinorUnit(plan.total.currency);
    return plan.items.reduce((sum, item) => {
      const type = String(item.serviceSnapshot.depositType ?? "NONE");
      const value = Number(item.serviceSnapshot.depositValue ?? 0);
      if (type === "FIXED") return sum + Math.round(value * 10 ** unit);
      if (type === "PERCENT") return sum + Math.round((Number(item.priceSnapshot.amountMinor ?? 0) * value) / 100);
      return sum;
    }, 0);
  }, [plan]);

  useEffect(() => {
    let active = true;
    setPageState("loading");
    getAuthorizedBranchContext().then((value) => {
      if (!active) return;
      setPermissions(value.context.authorization.permissions);
      setBranches(value.branches as Branch[]);
      const requestedBranchId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("branchId") : null;
      const requestedBranch = value.branches.find((item) => item.id === requestedBranchId);
      setBranchId(requestedBranch?.id ?? value.branchId ?? (value.branches.length === 1 ? value.branches[0]?.id ?? "" : ""));
      setPageState(value.branches.length ? "ready" : "empty");
      setPageError(value.branches.length ? "" : "Tài khoản chưa được cấp chi nhánh hoạt động.");
    }).catch((error: any) => {
      if (!active) return;
      setPageState(error?.forbidden ? "forbidden" : "error");
      setPageError(errorText(error, "Không thể tải thông tin truy cập."));
    });
    return () => { active = false; };
  }, [pageRefresh]);

  useEffect(() => {
    const handleBranchChange = (event: Event) => {
      const next = (event as CustomEvent<string | undefined>).detail;
      if (next && branches.some((item) => item.id === next)) {
        setBranchId(next);
        setSelectedServiceIds([]);
        setSelectedSlot(undefined);
        setPlan(undefined);
      }
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
  }, [branches]);

  useEffect(() => {
    if (!branchId) return;
    const seq = ++catalogSeq.current;
    setCatalogState("loading");
    setCatalogError("");
    setBranch(undefined);
    Promise.all([
      readJson(`/v1/branches/${branchId}`),
      readJson(`/v1/services?status=ACTIVE&branchId=${encodeURIComponent(branchId)}&page=1&pageSize=100`),
      readJson(`/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(branchId)}`),
    ]).then(([branchValue, serviceValue, staffValue]) => {
      if (seq !== catalogSeq.current) return;
      const nextBranch = branchValue as Branch;
      setBranch(nextBranch);
      setServices(rows(serviceValue) as Service[]);
      setStaff(rows(staffValue) as Staff[]);
      setDate((current) => current || branchLocalDate(nextBranch.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
      setCatalogState("ready");
    }).catch((error: any) => {
      if (seq !== catalogSeq.current) return;
      setCatalogState(error?.forbidden ? "forbidden" : "error");
      setCatalogError(errorText(error, "Không thể tải danh mục của chi nhánh."));
    });
  }, [branchId]);

  useEffect(() => {
    if (prefillApplied.current || catalogState !== "ready" || typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const requestedBranchId = query.get("branchId");
    if (requestedBranchId && branches.some((item) => item.id === requestedBranchId) && requestedBranchId !== branchId) return;
    const requestedServiceIds = (query.get("serviceIds") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const validServiceIds = requestedServiceIds.filter((id) => services.some((item) => item.id === id));
    if (requestedServiceIds.length && validServiceIds.length === requestedServiceIds.length) setSelectedServiceIds(validServiceIds.slice(0, 5));
    const requestedStaffId = query.get("staffId");
    if (requestedStaffId && staff.some((item) => item.id === requestedStaffId)) setPreferredStaffId(requestedStaffId);
    const requestedCustomerId = query.get("customerId");
    prefillApplied.current = true;
    if (requestedCustomerId) {
      void readJson(`/v1/customers/${encodeURIComponent(requestedCustomerId)}`).then((value: any) => {
        if (value?.profile?.id !== requestedCustomerId) return;
        setCustomer({ id: value.profile.id, displayName: value.profile.displayName, phone: value.contact?.phone, email: value.contact?.email, locale: value.profile.preferredLocale });
        setCustomerDetail(value);
      }).catch(() => undefined);
    }
  }, [branchId, branches, catalogState, services, staff]);

  useEffect(() => {
    const query = customerQuery.trim();
    if (query.length < 2) {
      setCustomerResults([]);
      setCustomerSearchState("idle");
      setCustomerSearchError("");
      return;
    }
    const seq = ++customerSearchSeq.current;
    const timer = window.setTimeout(() => {
      setCustomerSearchState("loading");
      readJson(`/v1/customers?search=${encodeURIComponent(query)}&limit=10`).then((value) => {
        if (seq !== customerSearchSeq.current) return;
        const found = rows(value) as Customer[];
        setCustomerResults(found);
        setCustomerSearchState(found.length ? "ready" : "empty");
      }).catch((error: any) => {
        if (seq !== customerSearchSeq.current) return;
        setCustomerSearchState(error?.forbidden ? "forbidden" : "error");
        setCustomerSearchError(errorText(error, "Không thể tìm khách hàng."));
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [customerQuery]);

  useEffect(() => {
    if (!customer?.id) {
      setCustomerDetail(undefined);
      return;
    }
    let active = true;
    readJson(`/v1/customers/${customer.id}`).then((value) => { if (active) setCustomerDetail(value); }).catch(() => { if (active) setCustomerDetail(undefined); });
    return () => { active = false; };
  }, [customer?.id]);

  useEffect(() => {
    if (!branchId || !timezone || !date || !selectedServiceIds[0]) {
      setSlots([]);
      setAvailabilityState("idle");
      setUnavailableReasons([]);
      return;
    }
    const seq = ++availabilitySeq.current;
    setAvailabilityState("loading");
    setAvailabilityError("");
    const query = new URLSearchParams({ branchId, serviceId: selectedServiceIds[0], dateFrom: date, dateTo: date, slotIntervalMin: "30" });
    if (preferredStaffId) query.set("staffId", preferredStaffId);
    readJson(`/v1/availability?${query.toString()}`).then((value: any) => {
      if (seq !== availabilitySeq.current) return;
      const found = (value.days?.flatMap((day: any) => day.slots ?? []) ?? []) as Slot[];
      const reasons = (value.days?.flatMap((day: any) => day.unavailableReasons ?? []) ?? []) as AvailabilityReason[];
      setSlots(found);
      setUnavailableReasons(reasons);
      setAvailabilityVersion(Number(value.dataVersion));
      setAvailabilityState(found.length ? "ready" : "empty");
      if (selectedSlot && !found.some((item) => item.fingerprint === selectedSlot.fingerprint)) {
        setSelectedSlot(undefined);
        setPlan(undefined);
      }
    }).catch((error: any) => {
      if (seq !== availabilitySeq.current) return;
      setAvailabilityState(error?.forbidden ? "forbidden" : "error");
      setAvailabilityError(errorText(error, "Không thể tải khung giờ trống."));
      setSlots([]);
      setUnavailableReasons([]);
    });
  }, [branchId, date, preferredStaffId, selectedServiceIds, timezone, availabilityRefresh]);

  useEffect(() => {
    if (!branchId || !selectedSlot || !selectedServiceIds.length) {
      setPlan(undefined);
      setPlanState("idle");
      return;
    }
    const seq = ++planSeq.current;
    setPlanState("loading");
    setPlanError("");
    const items = selectedServiceIds.map((serviceId, index) => ({ serviceId, staffPreference: index === 0 && preferredStaffId ? { type: "SPECIFIC", staffId: preferredStaffId } : { type: "ANY" }, ...(index === 0 ? { availabilityFingerprint: selectedSlot.fingerprint } : {}) }));
    readJson("/v1/booking-plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId, desiredStartAt: selectedSlot.startAt, items }) }).then((value) => {
      if (seq !== planSeq.current) return;
      setPlan(value as Plan);
      setPlanState("ready");
    }).catch((error: any) => {
      if (seq !== planSeq.current) return;
      setPlanState(error?.forbidden ? "forbidden" : "error");
      setPlanError(errorText(error, "Không thể lập kế hoạch lịch hẹn cho slot này."));
      setPlan(undefined);
    });
  }, [branchId, preferredStaffId, selectedServiceIds, selectedSlot]);

  useEffect(() => {
    if (!branchId || !timezone || !date || !resolvedStaffId) {
      setCalendarEvents([]);
      setCalendarState("idle");
      return;
    }
    const range = rangeForDate(date, timezone);
    setCalendarState("loading");
    const query = new URLSearchParams({ branchId, from: range.from, to: range.to, staffIds: resolvedStaffId, eventTypes: "APPOINTMENT,SHIFT,BUSY_BLOCK,LEAVE" });
    readJson(`/v1/calendar/events?${query.toString()}`).then((value: any) => {
      setCalendarEvents((value.events ?? []) as CalendarEvent[]);
      setCalendarState("ready");
    }).catch(() => {
      setCalendarState("error");
      setCalendarEvents([]);
    });
  }, [branchId, date, resolvedStaffId, timezone]);

  useEffect(() => {
    const dirty = Boolean(customer || selectedServiceIds.length || note.trim() || selectedSlot);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty && mutationState !== "ready") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [customer, mutationState, note, selectedServiceIds.length, selectedSlot]);

  const resetSelection = () => {
    setSelectedSlot(undefined);
    setPlan(undefined);
    setPlanState("idle");
    setPlanError("");
    holdIntentKey.current = undefined;
    appointmentIntentKey.current = undefined;
  };

  const changeBranch = (next: string) => {
    setBranchId(next);
    setActiveBranchId(next || undefined);
    setSelectedServiceIds([]);
    setPreferredStaffId("");
    resetSelection();
  };

  const addService = (id: string) => {
    if (!id || selectedServiceIds.length >= 5) return;
    setSelectedServiceIds((current) => [...current, id]);
    setServiceQuery("");
    resetSelection();
  };

  const removeService = (id: string) => {
    setSelectedServiceIds((current) => current.filter((item) => item !== id));
    resetSelection();
  };

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewCustomerError("");
    if (!newCustomer.displayName.trim() || (!newCustomer.phone.trim() && !newCustomer.email.trim())) {
      setNewCustomerError("Cần nhập họ tên và ít nhất số điện thoại hoặc email.");
      return;
    }
    setCustomerMutationState("loading");
    try {
       const intentKey = customerCreateIntentKey.current ?? (customerCreateIntentKey.current = crypto.randomUUID());
       const created = await command("/v1/customers", { displayName: newCustomer.displayName.trim(), phone: newCustomer.phone.trim() || undefined, email: newCustomer.email.trim() || undefined, locale: "vi-VN" }, intentKey);
      setCustomer(created as Customer);
      setCustomerQuery("");
      setCustomerResults([]);
       setShowNewCustomer(false);
       setNewCustomer({ displayName: "", phone: "", email: "" });
       customerCreateIntentKey.current = undefined;
       setCustomerMutationState("ready");
    } catch (error: any) {
      setCustomerMutationState(error?.forbidden ? "forbidden" : "error");
      setNewCustomerError(errorText(error, "Không thể tạo khách hàng mới."));
    }
  };

  const createAppointment = async () => {
    if (!canCreate || mutationState === "loading") return;
    setMutationError("");
    if (!branchId || !customer?.id || !selectedServiceIds.length || !selectedSlot || !plan) {
      setMutationState("error");
      setMutationError("Hãy chọn khách hàng, dịch vụ và khung giờ hợp lệ trước khi tạo lịch.");
      return;
    }
    setMutationState("loading");
    try {
      const holdKey = holdIntentKey.current ?? (holdIntentKey.current = crypto.randomUUID());
      const appointmentKey = appointmentIntentKey.current ?? (appointmentIntentKey.current = crypto.randomUUID());
      const hold = await command("/v1/slot-holds", {
        branchId,
        desiredStartAt: selectedSlot.startAt,
        availabilityDataVersion: plan.availabilityDataVersion ?? availabilityVersion,
        source,
        clientKey: holdKey,
        items: plan.items.map((item) => ({ serviceId: item.serviceId, staffPreference: { type: "SPECIFIC", staffId: item.staffId }, availabilityFingerprint: item.availabilityFingerprint })),
      }, holdKey);
      const appointment = await command("/v1/appointments", {
        holdId: hold.holdId,
        holdToken: hold.holdToken,
        customer: { customerId: customer.id, locale: customer.locale ?? "vi-VN" },
        customerNote: note.trim() || undefined,
        confirm: true,
      }, appointmentKey);
      setMutationState("ready");
      holdIntentKey.current = undefined;
      appointmentIntentKey.current = undefined;
      router.push(`/admin/appointments/${appointment.id}/overview`);
    } catch (error: any) {
      setMutationState(error?.forbidden ? "forbidden" : "error");
      setMutationError(errorText(error, "Không thể tạo lịch hẹn."));
      if (["SLOT_UNAVAILABLE", "STAFF_RESERVED", "RESOURCE_CAPACITY_INSUFFICIENT", "AVAILABILITY_CHANGED", "BOOKING_VERSION_CONFLICT"].includes(error?.code)) {
        resetSelection();
        setAvailabilityRefresh((value) => value + 1);
      }
    }
  };

  const servicePrice = (serviceId: string) => {
    const item = plan?.items.find((value) => value.serviceId === serviceId);
    return item ? formatMoneyMinor(item.priceSnapshot.amountMinor, item.priceSnapshot.currency) : "Chưa tính";
  };

  if (pageState !== "ready") return <main className="ns-create-appointment-page"><StateMessage state={pageState} error={pageError} label="thông tin chi nhánh" {...(pageState === "error" ? { retry: () => setPageRefresh((value) => value + 1) } : {})} /></main>;

  return <main className="ns-create-appointment-page">
    <header className="ns-create-page-head">
      <div><p className="ns-create-eyebrow">LỊCH HẸN</p><h1>Tạo lịch hẹn mới</h1><p>Tạo lịch hẹn cho khách hàng, chọn dịch vụ, kỹ thuật viên và khung giờ phù hợp.</p></div>
      <div className="ns-create-page-actions"><button type="button" className="ns-create-button ns-create-button--quiet" onClick={() => router.push("/admin/appointments")}><Icon name="close" /> Hủy</button><button type="button" className="ns-create-button ns-create-button--primary" disabled={!canCreate || mutationState === "loading" || !customer?.id || !selectedServiceIds.length || !selectedSlot || !plan} onClick={() => void createAppointment()}><Icon name="calendar" /> {mutationState === "loading" ? "Đang tạo lịch…" : "Tạo lịch hẹn"}</button></div>
    </header>
    <div className="ns-create-layout">
      <div className="ns-create-main-column">
        <Card title="Thông tin khách hàng" icon="customer" action={canCreateCustomer ? <button type="button" className="ns-create-link-button" onClick={() => { customerCreateIntentKey.current = undefined; setShowNewCustomer(true); setNewCustomerError(""); }}> <Icon name="plus" /> Khách mới</button> : null}>
          <div className="ns-create-search-field">
            <div className="ns-create-customer-search"><Icon name="search" /><input value={customerQuery} placeholder="Tìm khách hàng theo tên / SĐT / email" onFocus={() => setShowCustomerResults(true)} onChange={(event) => { setCustomerQuery(event.target.value); setShowCustomerResults(true); }} /><span className="ns-create-shortcut">⌘K</span></div>
            {showCustomerResults && customerQuery.trim().length >= 2 ? <div className="ns-create-search-results"><StateMessage state={customerSearchState} error={customerSearchError} label="khách hàng" />{customerSearchState === "ready" ? customerResults.map((item) => <button type="button" key={item.id} onClick={() => { setCustomer(item); setCustomerQuery(""); setShowCustomerResults(false); }}><span className="ns-create-avatar">{item.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{item.displayName}</strong><small>{item.phone ?? item.email ?? "Không có thông tin liên hệ"}</small></span><Icon name="chevronRight" /></button>) : null}</div> : null}
          </div>
          {customer ? <div className="ns-create-selected-customer"><span className="ns-create-avatar ns-create-avatar--large">{customer.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{customer.displayName}</strong><span>{customer.phone ?? "Chưa có số điện thoại"}{customer.email ? ` · ${customer.email}` : ""}</span>{customerDetail?.activitySummary ? <small>{customerDetail.activitySummary.completedVisitCount ?? 0} lượt đã hoàn thành · {customerDetail.activitySummary.appointmentCount ?? 0} lịch trong hệ thống</small> : null}</div><button type="button" aria-label="Bỏ chọn khách hàng" onClick={() => setCustomer(undefined)}><Icon name="close" /></button></div> : <div className="ns-create-empty-selection"><Icon name="customer" /><span>Chưa chọn khách hàng</span><small>Tìm theo tên, số điện thoại hoặc email để bắt đầu.</small></div>}
        </Card>

        <Card title="Thông tin lịch hẹn" icon="calendar">
          <div className="ns-create-form-grid ns-create-form-grid--four">
            <Field label="Chi nhánh"><select value={branchId} onChange={(event) => changeBranch(event.target.value)}><option value="">Chọn chi nhánh</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Ngày hẹn" hint={timezone ? `Múi giờ: ${timezone}` : undefined}><input ref={dateInputRef} type="date" value={date} onChange={(event) => { setDate(event.target.value); resetSelection(); }} /></Field>
            <Field label="Giờ bắt đầu"><div className="ns-create-readonly-input">{selectedSlot ? formatTime(selectedSlot.startAt, timezone) : "Chọn khung giờ bên dưới"}</div></Field>
            <Field label="Thời lượng dự kiến"><div className="ns-create-readonly-input">{totalDuration ? `${totalDuration} phút` : "—"}</div></Field>
            <Field label="Nguồn đặt lịch"><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="RECEPTION">Lễ tân</option><option value="OWNER_MOBILE">Chủ salon</option></select></Field>
            <Field label="Địa điểm"><div className="ns-create-location-chip"><Icon name="store" /> Tại salon <small>Địa điểm tại nhà chưa được hỗ trợ</small></div></Field>
          </div>
          <div className="ns-create-slot-heading"><div><strong>Khung giờ khả dụng</strong><span>{selectedServiceIds.length ? "Mỗi ô là giờ bắt đầu; thời lượng được tính theo dịch vụ và buffer thực tế." : "Chọn ít nhất một dịch vụ để tải availability"}</span></div><button type="button" className="ns-create-icon-button" aria-label="Làm mới khung giờ" onClick={() => setAvailabilityRefresh((value) => value + 1)} disabled={availabilityState === "loading"}><Icon name="refresh" /></button></div>
          {selectedServiceIds.length ? <div className="ns-create-slot-guide"><Icon name="clock" /><div><strong>Khung giờ được tính như thế nào?</strong><p>Các mốc được kiểm tra theo bước 30 phút; mỗi ô là giờ bắt đầu. Hệ thống chỉ hiển thị giờ có ca làm đã công bố, kỹ thuật viên đủ điều kiện, bảng giá hiệu lực và không bị trùng lịch. Chọn một ô để xem giá, thời lượng và nhân sự thực tế.</p></div></div> : null}
          {availabilityState === "loading" || availabilityState === "error" || availabilityState === "forbidden" ? <StateMessage state={availabilityState} error={availabilityError} label="khung giờ" retry={() => setAvailabilityRefresh((value) => value + 1)} /> : null}
          {availabilityState === "empty" ? <div className="ns-create-empty-slots" role="status"><div className="ns-create-empty-slots__intro"><span><Icon name="clock" /></span><div><strong>Ngày này chưa có khung giờ đặt được</strong><p>{unavailableReasons.length ? "Availability engine ghi nhận các nguyên nhân sau:" : "Chưa có dữ liệu availability phù hợp cho bộ lọc hiện tại."}</p></div></div>{unavailableReasons.length ? <ul>{unavailableReasons.slice(0, 3).map((reason) => <li key={reason.code}>{availabilityReasonLabel(reason.code)}{reason.count && reason.count > 1 ? ` (${reason.count})` : ""}</li>)}</ul> : null}<div className="ns-create-slot-context"><span>Chi nhánh: <strong>{branch?.name ?? "—"}</strong></span><span>Ngày: <strong>{dateLabel(date)}</strong></span><span>Dịch vụ: <strong>{selectedServices.map(labelOf).join(", ") || "—"}</strong></span></div><button type="button" className="ns-create-text-link" onClick={() => dateInputRef.current?.focus()}>Đổi ngày để tìm giờ khác <Icon name="arrowRight" /></button></div> : null}
          {availabilityState === "ready" ? <div className="ns-create-slots" role="listbox" aria-label="Khung giờ khả dụng">{slots.slice(0, 32).map((slot) => <button type="button" role="option" aria-selected={selectedSlot?.fingerprint === slot.fingerprint} className={`ns-create-slot ${selectedSlot?.fingerprint === slot.fingerprint ? "is-selected" : ""}`} key={slot.fingerprint} onClick={() => { holdIntentKey.current = undefined; appointmentIntentKey.current = undefined; setSelectedSlot(slot); setPlan(undefined); setMutationError(""); }}><strong>{formatTime(slot.startAt, timezone)}</strong><span>{slot.staffCandidates?.length ?? 0} kỹ thuật viên phù hợp</span></button>)}</div> : null}
          {selectedSlot ? <div className="ns-create-selected-slot"><Icon name="check" /><span>Đã chọn <strong>{formatTime(selectedSlot.startAt, timezone)} – {formatTime(selectedSlot.endAt, timezone)}</strong></span>{planState === "loading" ? <small>Đang kiểm tra giá và phân bổ…</small> : null}</div> : null}
          {planState === "error" || planState === "forbidden" ? <StateMessage state={planState} error={planError} label="kế hoạch lịch hẹn" retry={() => { setSelectedSlot(undefined); setPlan(undefined); }} /> : null}
        </Card>

        <Card title="Dịch vụ đã chọn" icon="receipt" action={<span className="ns-create-card-counter">{selectedServiceIds.length}/5 dịch vụ</span>}>
          <div className="ns-create-service-picker-wrap">
            <div className="ns-create-service-picker"><Icon name="search" /><input value={serviceQuery} placeholder="Tìm dịch vụ để thêm…" onFocus={() => setServiceQuery(serviceQuery)} onChange={(event) => setServiceQuery(event.target.value)} /><span>{selectedServices.reduce((sum, item) => sum + Number(item.defaultDurationMin ?? 0), 0)} phút cơ bản</span></div>
            {serviceQuery.trim() ? <div className="ns-create-service-options">{filteredServices.length ? filteredServices.map((item) => <button type="button" key={item.id} onClick={() => addService(item.id)}><span className="ns-create-service-mark"><Icon name="tag" /></span><span><strong>{labelOf(item)}</strong><small>{item.defaultDurationMin ?? "—"} phút · {item.code ?? ""}</small></span><Icon name="plus" /></button>) : <p>Không có dịch vụ phù hợp tại chi nhánh này.</p>}</div> : null}
          </div>
          {catalogState === "loading" ? <StateMessage state="loading" label="dịch vụ" /> : null}
          {catalogState === "error" || catalogState === "forbidden" ? <StateMessage state={catalogState} error={catalogError} label="danh mục dịch vụ" /> : null}
          {selectedServices.length ? <div className="ns-create-service-list">{selectedServices.map((item, index) => <article key={item.id}><span className={`ns-create-service-mark ns-create-service-mark--${index % 3}`}><Icon name={index % 2 ? "tag" : "gift"} /></span><div><strong>{labelOf(item)}</strong><small>{typeof item.description === "string" ? item.description : item.description?.["vi-VN"] ?? `${item.defaultDurationMin ?? "—"} phút phục vụ`}</small></div><span className="ns-create-service-duration"><Icon name="clock" />{plan?.items.find((value) => value.serviceId === item.id)?.serviceSnapshot.durationMin ?? item.defaultDurationMin ?? "—"} phút</span><strong className="ns-create-service-price">{servicePrice(item.id)}</strong><button type="button" aria-label={`Xóa ${labelOf(item)}`} onClick={() => removeService(item.id)}><Icon name="close" /></button></article>)}</div> : <div className="ns-create-empty-selection ns-create-empty-selection--compact"><Icon name="receipt" /><span>Chưa chọn dịch vụ</span><small>Tìm và thêm dịch vụ đang hoạt động tại chi nhánh.</small></div>}
        </Card>

        <Card title="Ghi chú" icon="file"><textarea className="ns-create-notes" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú về mẫu móng, tone màu, yêu cầu đặc biệt của khách…" /><div className="ns-create-character-count">{note.length}/2000</div></Card>

        <Card title="Lịch sử gần đây" icon="clock" action={customer ? <a className="ns-create-text-link" href={`/admin/customers/${customer.id}`}>Xem hồ sơ khách hàng <Icon name="arrowRight" /></a> : null}>
          {customerDetail?.recentAppointments?.length ? <div className="ns-create-history-list">{customerDetail.recentAppointments.slice(0, 4).map((item: any) => <div key={item.id}><span><strong>{item.bookingReference}</strong><small>{formatDateTime(item.scheduledStartAt, timezone)}</small></span><span className={`ns-create-status ns-create-status--${String(item.status).toLowerCase()}`}>{item.status}</span></div>)}</div> : <div className="ns-create-inline-empty">{customer ? "Khách hàng chưa có lịch sử lịch hẹn trong phạm vi truy cập." : "Chọn khách hàng để xem lịch sử gần đây."}</div>}
        </Card>
      </div>

      <aside className="ns-create-side-column">
        <Card title="Kỹ thuật viên phù hợp" icon="staff" action={resolvedStaff ? <span className="ns-create-selected-pill"><Icon name="check" /> {resolvedStaff.displayName}</span> : null}>
          <p className="ns-create-helper">Danh sách được availability engine trả về cho slot đã chọn.</p>
          {eligibleStaff.length ? <div className="ns-create-staff-list">{eligibleStaff.map((candidate) => <button type="button" key={candidate.staffId} className={resolvedStaffId === candidate.staffId ? "is-selected" : ""} onClick={() => { setPreferredStaffId(candidate.staffId); resetSelection(); }}><span className="ns-create-avatar">{candidate.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{candidate.displayName}</strong><small>Đủ điều kiện · điểm {candidate.qualificationScore ?? "—"}</small></span><span className="ns-create-staff-status">{resolvedStaffId === candidate.staffId ? <Icon name="check" /> : "Trống"}</span></button>)}</div> : <div className="ns-create-inline-empty">Chọn một khung giờ để xem kỹ thuật viên đủ điều kiện.</div>}
          {eligibleStaff.length ? <button type="button" className="ns-create-any-staff" onClick={() => { setPreferredStaffId(""); resetSelection(); }}>Để hệ thống tự phân bổ kỹ thuật viên</button> : null}
        </Card>

        <Card title="Tóm tắt lịch hẹn" icon="receipt" className="ns-create-summary-card">
          <dl className="ns-create-summary-list"><div><dt>Khách hàng</dt><dd>{customer?.displayName ?? "Chưa chọn"}</dd></div><div><dt>Dịch vụ</dt><dd>{selectedServices.length ? `${selectedServices.length} dịch vụ` : "Chưa chọn"}</dd></div><div><dt>Ngày & giờ</dt><dd>{selectedSlot ? `${date} · ${formatTime(selectedSlot.startAt, timezone)}` : "Chưa chọn"}</dd></div><div><dt>Kỹ thuật viên</dt><dd>{resolvedStaff?.displayName ?? "Hệ thống tự phân bổ"}</dd></div><div><dt>Tổng thời lượng</dt><dd>{totalDuration ? `${totalDuration} phút` : "—"}</dd></div></dl>
          <div className="ns-create-summary-total"><span>Tổng cộng</span><strong>{plan ? formatMoneyMinor(plan.total.amountMinor, plan.total.currency) : "Chưa tính"}</strong></div>
          <div className="ns-create-deposit-row"><span>Tiền cọc theo chính sách</span><strong>{plan ? depositMinor ? formatMoneyMinor(depositMinor, plan.total.currency) : "Không yêu cầu" : "Chưa tính"}</strong></div>
        </Card>

        <Card title="Kiểm tra khả dụng" icon="calendar">
          <div className="ns-create-timeline-head"><span>{resolvedStaff?.displayName ?? "Kỹ thuật viên được phân bổ"}</span><small>{date || "Chưa chọn ngày"}</small></div>
          {calendarState === "loading" ? <StateMessage state="loading" label="lịch kỹ thuật viên" /> : null}
          {calendarState === "error" ? <div className="ns-create-inline-empty">Không tải được lịch chi tiết; availability slot vẫn là nguồn dữ liệu tạo hold.</div> : null}
          {calendarState === "ready" ? <div className="ns-create-timeline"><div className="ns-create-timeline-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div className="ns-create-timeline-track">{calendarEvents.map((event) => <span key={event.id} className={`ns-create-event ns-create-event--${event.eventType.toLowerCase()}`} style={{ left: `${Math.max(0, (new Date(event.startAt).getTime() - new Date(`${date}T00:00:00${branchOffset(date, timezone)}`).getTime()) / 86_400_000 * 100)}%`, width: `${Math.min(100, Math.max(1, (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 86_400_000 * 100))}%` }} title={event.title}>{event.eventType}</span>)}{selectedSlot ? <span className="ns-create-event ns-create-event--selected" style={{ left: `${Math.max(0, (new Date(selectedSlot.startAt).getTime() - new Date(`${date}T00:00:00${branchOffset(date, timezone)}`).getTime()) / 86_400_000 * 100)}%`, width: `${Math.max(1, (new Date(selectedSlot.endAt).getTime() - new Date(selectedSlot.startAt).getTime()) / 86_400_000 * 100)}%` }} title="Slot đang chọn" /> : null}</div><div className="ns-create-timeline-legend"><span><i className="is-booked" /> Đã có lịch</span><span><i className="is-selected" /> Đang chọn</span></div></div> : null}
          {!resolvedStaffId ? <div className="ns-create-inline-empty">Chọn slot để hệ thống chọn kỹ thuật viên và tải lịch thực tế.</div> : null}
        </Card>

        <div className="ns-create-capability-note"><Icon name="notification" /><div><strong>Nhắc hẹn</strong><p>Thông báo giao dịch được phát sinh theo outbox và cấu hình notification backend sau khi lịch được tạo. Màn hình này không bật/tắt SMS hoặc email giả lập.</p></div></div>
      </aside>
    </div>
    {mutationError ? <div className="ns-create-submit-error" role="alert"><Icon name="alert" />{mutationError}</div> : null}
    <footer className="ns-create-sticky-footer"><button type="button" className="ns-create-button ns-create-button--quiet" onClick={() => router.push("/admin/appointments")}>Hủy</button><div><span>{plan ? `${selectedServices.length} dịch vụ · ${formatMoneyMinor(plan.total.amountMinor, plan.total.currency)}` : "Chưa đủ thông tin để tính giá"}</span><button type="button" className="ns-create-button ns-create-button--primary" disabled={!canCreate || mutationState === "loading"} onClick={() => void createAppointment()}><Icon name="calendar" /> {mutationState === "loading" ? "Đang tạo lịch…" : "Tạo lịch hẹn"}</button></div></footer>

    {showNewCustomer ? <div className="ns-create-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewCustomer(false); }}><div className="ns-create-modal" role="dialog" aria-modal="true" aria-labelledby="new-customer-title"><div className="ns-create-modal-head"><div><p className="ns-create-eyebrow">KHÁCH HÀNG</p><h2 id="new-customer-title">Thêm khách hàng mới</h2></div><button type="button" aria-label="Đóng" onClick={() => setShowNewCustomer(false)}><Icon name="close" /></button></div><form onSubmit={(event) => void createCustomer(event)}><Field label="Họ và tên"><input autoFocus value={newCustomer.displayName} onChange={(event) => { customerCreateIntentKey.current = undefined; setNewCustomer({ ...newCustomer, displayName: event.target.value }); }} required /></Field><Field label="Số điện thoại"><input type="tel" value={newCustomer.phone} onChange={(event) => { customerCreateIntentKey.current = undefined; setNewCustomer({ ...newCustomer, phone: event.target.value }); }} /></Field><Field label="Email"><input type="email" value={newCustomer.email} onChange={(event) => { customerCreateIntentKey.current = undefined; setNewCustomer({ ...newCustomer, email: event.target.value }); }} /></Field>{newCustomerError ? <p className="ns-create-form-error" role="alert">{newCustomerError}</p> : null}<div className="ns-create-modal-actions"><button type="button" className="ns-create-button ns-create-button--quiet" onClick={() => setShowNewCustomer(false)}>Hủy</button><button type="submit" className="ns-create-button ns-create-button--primary" disabled={customerMutationState === "loading"}>{customerMutationState === "loading" ? "Đang lưu…" : "Tạo khách hàng"}</button></div></form></div></div> : null}
  </main>;
}
