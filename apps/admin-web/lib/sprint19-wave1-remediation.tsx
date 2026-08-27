/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_BRANCH_CHANGED_EVENT, authorizedFetch, getAuthorizedBranchContext, setActiveBranchId } from "./auth";
import CreateAppointmentPage from "./create-appointment";
import AppointmentDetailPage from "./sprint19-wave1/appointment-detail";
import AppointmentReschedulePage from "./sprint19-wave1/appointment-reschedule";
import AppointmentCancelPage from "./sprint19-wave1/appointment-cancel";
import AppointmentCheckInPage from "./sprint19-wave1/appointment-check-in";
import AppointmentAddServicePage from "./sprint19-wave1/appointment-add-service";
import AppointmentCheckoutSummaryPage from "./sprint19-wave1/appointment-checkout-summary";
import ServiceSessionPage from "./sprint19-wave1/service-session-page";

type State = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";

function zonedDateTimeToIso(localDate: string, localTime: string, timeZone: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = localTime.split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day, hour, minute, second);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>;
    const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    guess = desired - (localAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

function rows(value: any): any[] {
  const data = value?.data ?? value;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function request(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Không có quyền truy cập"), { forbidden: true });
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Không thể hoàn tất thao tác"), {
      code: body?.error?.code,
      status: response.status,
    });
  }
  return body?.data ?? body;
}

function command(path: string, body: unknown, idempotencyKey = crypto.randomUUID()) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function labelOf(service: any) {
  return service?.name?.["vi-VN"] ?? service?.name?.["en-US"] ?? service?.name ?? service?.code ?? "Dịch vụ";
}

function useRemote(path: string | null, empty = false) {
  const [state, setState] = useState<State>(path ? "loading" : "empty");
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    setState("loading");
    setError("");
    try {
      const value = await request(path);
      setData(value);
      setState(empty || rows(value).length === 0 ? "empty" : "ready");
    } catch (cause: any) {
      setError(cause?.message ?? "Không thể tải dữ liệu");
      setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [empty, path]);
  useEffect(() => { void load(); }, [load]);
  return { state, data, error, load, setData, setState, setError };
}

function StatePanel({ state, error, retry, label }: { state: State; error?: string; retry: () => void; label: string }) {
  if (state === "loading") return <div className="s19-state s19-state-loading" role="status"><span className="s19-spinner" />Đang tải {label}…</div>;
  if (state === "forbidden") return <div className="s19-state s19-state-danger" role="alert"><strong>Không có quyền truy cập</strong><span>{error || "Vai trò hoặc phạm vi chi nhánh hiện tại không cho phép xem khu vực này."}</span><button className="s19-button s19-button-secondary" onClick={retry}>Thử lại</button></div>;
  if (state === "offline") return <div className="s19-state" role="alert"><strong>Cần kết nối Internet</strong><span>Thao tác nghiệp vụ không được xác nhận khi offline.</span><button className="s19-button s19-button-secondary" onClick={retry}>Thử lại</button></div>;
  if (state === "error") return <div className="s19-state s19-state-danger" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error ?? "Có lỗi xảy ra."}</span><button className="s19-button s19-button-secondary" onClick={retry}>Thử lại</button></div>;
  if (state === "empty") return <div className="s19-state" role="status"><strong>Chưa có dữ liệu</strong><span>Không có bản ghi phù hợp với bộ lọc hiện tại.</span><button className="s19-button s19-button-secondary" onClick={retry}>Làm mới</button></div>;
  return null;
}

function Shell({ title, eyebrow, description, accessibilityTitle, actions, children }: { title: string; eyebrow: string; description: string; accessibilityTitle?: string; actions?: ReactNode; children: ReactNode }) {
  return <main className="s19-remediation-shell"><section className="s19-remediation-page"><div className="s19-page-heading"><div><p className="s19-eyebrow">Vận hành · {eyebrow}</p><h1 aria-label={accessibilityTitle}>{title}</h1><p>{description}</p></div>{actions ? <div className="s19-page-actions">{actions}</div> : null}</div>{children}</section></main>;
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return <label className="s19-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Notice({ tone = "success", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  return <div className={`s19-notice s19-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

function useLookups() {
  const [state, setState] = useState<State>("loading"), [error, setError] = useState(""), [value, setValue] = useState({ branches: [] as any[], activeBranchId: undefined as string | undefined, services: [] as any[], customers: [] as any[], staff: [] as any[] });
  const load = useCallback(async () => {
    setState("loading");
    try {
      const [branchContext, services, customers, staff] = await Promise.all([
        getAuthorizedBranchContext(), request("/v1/services?status=ACTIVE&pageSize=100"), request("/v1/customers?limit=100"), request("/v1/staff?status=ACTIVE"),
      ]);
      setValue({ branches: branchContext.branches, activeBranchId: branchContext.branchId, services: rows(services), customers: rows(customers), staff: rows(staff) });
      setState("ready");
    } catch (cause: any) { setError(cause?.message ?? "Không thể tải danh mục"); setState(cause?.forbidden ? "forbidden" : "error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { state, error, ...value, load, setValue };
}

export function CreateBookingScreen() {
  const lookup = useLookups();
  const [step, setStep] = useState(1);
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<any[]>([]);
  const [version, setVersion] = useState<number>();
  const [selected, setSelected] = useState<any>();
  const [result, setResult] = useState<any>();
  const [state, setState] = useState<State>("ready");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const intentKeys = useRef<{ hold?: string; appointment?: string }>({});
  const branch = lookup.branches.find((item) => item.id === branchId);
  const selectedServices = lookup.services.filter((item) => serviceIds.includes(item.id));

  useEffect(() => {
    if (!branchId && lookup.activeBranchId) setBranchId(lookup.activeBranchId);
    else if (!branchId && lookup.branches.length === 1 && lookup.branches[0]?.id) setBranchId(lookup.branches[0].id);
  }, [branchId, lookup.activeBranchId, lookup.branches]);

  const resetAvailability = () => {
    setStep(1);
    setSlots([]);
    setSelected(undefined);
    setVersion(undefined);
    setError("");
    setState("ready");
  };

  const selectBranch = (nextBranchId: string) => {
    setBranchId(nextBranchId);
    setActiveBranchId(nextBranchId || undefined);
    resetAvailability();
  };

  useEffect(() => {
    const handleBranchChange = (event: Event) => {
      const nextBranchId = (event as CustomEvent<string | undefined>).detail;
      if (!nextBranchId || lookup.branches.some((item) => item.id === nextBranchId)) {
        setBranchId(nextBranchId ?? "");
        resetAvailability();
      }
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
  }, [lookup.branches]);

  const findSlots = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSelected(undefined);
    if (!branchId || !customerId || !serviceIds.length || !date) {
      setState("error");
      setError("Hãy chọn khách hàng, dịch vụ, chi nhánh và ngày.");
      return;
    }
    setState("loading");
    try {
      const params = new URLSearchParams({ branchId, serviceId: serviceIds[0] ?? "", dateFrom: date, dateTo: date, slotIntervalMin: "15" });
      if (staffId) params.set("staffId", staffId);
      const data = await request(`/v1/availability?${params.toString()}`);
      const found = data.days?.flatMap((day: any) => day.slots ?? []) ?? [];
      setSlots(found);
      setVersion(data.dataVersion);
      setState(found.length ? "ready" : "empty");
      if (found.length) setStep(3);
    } catch (cause: any) {
      setError(cause?.forbidden ? "Chi nhánh hoặc quyền hiện tại không cho phép tìm khung giờ. Hãy chọn chi nhánh được cấp quyền rồi thử lại." : cause?.message ?? "Không thể tìm slot");
      setState(cause?.forbidden ? "forbidden" : "error");
    }
  };

  const create = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setState("loading");
    try {
      const hold = await command("/v1/slot-holds", {
        branchId,
        desiredStartAt: selected.startAt,
        availabilityDataVersion: version,
        source: "RECEPTION",
        clientKey: intentKeys.current.hold ?? (intentKeys.current.hold = crypto.randomUUID()),
        items: serviceIds.map((id, index) => ({ serviceId: id, staffPreference: index === 0 && staffId ? { type: "SPECIFIC", staffId } : { type: "ANY" }, ...(index === 0 ? { availabilityFingerprint: selected.fingerprint } : {}) })),
      }, intentKeys.current.hold);
      const appointment = await command("/v1/appointments", {
        holdId: hold.holdId,
        holdToken: hold.holdToken,
        customer: { customerId, locale: "vi-VN" },
        customerNote: note || undefined,
        confirm: true,
      }, intentKeys.current.appointment ?? (intentKeys.current.appointment = crypto.randomUUID()));
      setResult(appointment);
      intentKeys.current = {};
      setStep(5);
      setState("ready");
    } catch (cause: any) {
      setError(cause?.code === "BOOKING_VERSION_CONFLICT" || cause?.code === "AVAILABILITY_CHANGED" ? "Slot đã thay đổi. Hãy tìm lại availability trước khi thử lại." : cause?.message ?? "Không thể tạo lịch hẹn");
      setState(cause?.forbidden ? "forbidden" : "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell accessibilityTitle="Quick create" eyebrow="Tạo lịch hẹn" title="Tạo booking trong vài bước" description="Chọn khách, dịch vụ và slot hợp lệ theo múi giờ chi nhánh. Giá và lịch được snapshot khi hold được consume." actions={<a className="s19-button s19-button-secondary" href="/admin/appointments">Quay về danh sách</a>}>
      <ol className="s19-stepper" aria-label="Các bước tạo lịch hẹn">
        {["Khách hàng", "Dịch vụ", "Slot", "Review", "Hoàn tất"].map((item, index) => <li className={step === index + 1 ? "is-active" : step > index + 1 ? "is-done" : ""} key={item}><span>{index + 1}</span>{item}</li>)}
      </ol>

      <StatePanel state={lookup.state} error={lookup.error} retry={lookup.load} label="danh mục" />

      {lookup.state === "ready" && step < 3 ? (
        <form className="s19-form-card" onSubmit={findSlots}>
          <div className="s19-form-grid">
            <Field label="Chi nhánh" hint={branch?.timezone ? `Múi giờ: ${branch.timezone}` : "Chọn chi nhánh được cấp quyền"}>
              <select name="branchId" value={branchId} onChange={(event) => selectBranch(event.target.value)} required>
                <option value="">Chọn chi nhánh</option>
                {lookup.branches.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.code}</option>)}
              </select>
            </Field>
            <Field label="Tìm khách hàng" hint="Chọn khách hàng cụ thể để tránh tạo nhầm booking">
              <select name="customerId" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setError(""); }} required>
                <option value="">Chọn khách hàng</option>
                {lookup.customers.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.phone ?? item.email ?? item.id}</option>)}
              </select>
            </Field>
            <Field label="Dịch vụ" hint={serviceIds.length ? `Đã chọn ${serviceIds.length}/5 dịch vụ theo thứ tự thực hiện` : "Chọn tối đa 5 dịch vụ theo thứ tự thực hiện"}>
              <select name="serviceIds" multiple size={Math.min(5, Math.max(3, lookup.services.length))} value={serviceIds} onChange={(event) => { setServiceIds(Array.from(event.target.selectedOptions).map((option) => option.value)); setError(""); }} required>
                {lookup.services.map((item) => <option key={item.id} value={item.id}>{labelOf(item)} · {item.defaultDurationMin ?? "—"} phút</option>)}
              </select>
            </Field>
            <Field label="Nhân sự ưu tiên">
              <select aria-label="Technician for the first service" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                <option value="">Bất kỳ nhân sự đủ điều kiện</option>
                {lookup.staff.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </Field>
            <Field label="Ngày theo múi giờ chi nhánh">
              <input aria-label="Date in branch timezone" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="Ghi chú khách hàng" hint="Không lưu thông tin nhạy cảm ngoài mục đích phục vụ">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} />
            </Field>
          </div>

          {state !== "ready" ? <StatePanel state={state} error={error} retry={resetAvailability} label="khung giờ" /> : null}

          <div className="s19-form-actions">
            <button aria-label="Find availability" className="s19-button s19-button-primary" disabled={state === "loading"}>
              {state === "loading" ? "Đang tìm slot…" : "Tìm slot khả dụng"}
            </button>
          </div>
        </form>
      ) : null}

      {step >= 3 && state !== "ready" ? <StatePanel state={state} error={error} retry={resetAvailability} label="khung giờ" /> : null}

      {step === 3 && state === "ready" ? (
        <section className="s19-card">
          <div className="s19-card-heading"><div><p className="s19-eyebrow">Availability</p><h2>Chọn slot phù hợp</h2></div><span className="s19-status s19-status-info">{slots.length} slot</span></div>
          <div className="slots s19-slot-grid">
            {slots.slice(0, 24).map((slot) => <button type="button" className={`s19-slot ${selected?.fingerprint === slot.fingerprint ? "is-selected" : ""}`} key={slot.fingerprint} onClick={() => { setSelected(slot); setStep(4); }}><strong>{new Date(slot.startAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: branch?.timezone })}</strong><span>{slot.staffCandidates?.[0]?.displayName ?? "Nhân sự phù hợp"}</span><small>{slot.priceReference?.amount ?? "—"} {slot.priceReference?.currency ?? "VND"}</small></button>)}
          </div>
          <p className="s19-helper">Slot chỉ là estimate hiện tại; Booking Engine mới tạo hold có hiệu lực.</p>
        </section>
      ) : null}

      {step === 4 && selected ? (
        <section className="s19-card s19-review">
          <div className="s19-card-heading"><div><p className="s19-eyebrow">Review trước khi tạo</p><h2>Xác nhận thông tin booking</h2></div></div>
          <dl className="s19-summary-grid">
            <div><dt>Khách hàng</dt><dd>{lookup.customers.find((item) => item.id === customerId)?.displayName ?? customerId}</dd></div>
            <div><dt>Chi nhánh</dt><dd>{branch?.name ?? branchId} · {branch?.timezone ?? "timezone"}</dd></div>
            <div><dt>Slot</dt><dd>{new Date(selected.startAt).toLocaleString("vi-VN", { timeZone: branch?.timezone })}</dd></div>
            <div><dt>Dịch vụ</dt><dd>{selectedServices.map(labelOf).join(" · ")}</dd></div>
            <div><dt>Ghi chú</dt><dd>{note || "Không có"}</dd></div>
          </dl>
          <div className="s19-form-actions"><button type="button" className="s19-button s19-button-secondary" onClick={() => { setState("ready"); setStep(3); }}>Chọn slot khác</button><button type="button" aria-label="Create and confirm" className="s19-button s19-button-primary" onClick={() => void create()} disabled={saving}>{saving ? "Đang tạo…" : "Tạo và xác nhận booking"}</button></div>
        </section>
      ) : null}

      {step === 5 && result ? <section className="s19-success-card" role="status"><span className="s19-success-icon">✓</span><div><p className="s19-eyebrow">Đã tạo thành công</p><h2 aria-label="Appointment created">{result.bookingReference}</h2><p>Booking đã được xác nhận và sẵn sàng cho vận hành.</p><a aria-label="Open appointment" className="s19-button s19-button-primary" href={`/admin/appointments/${result.id}/overview`}>Mở booking detail</a></div></section> : null}
    </Shell>
  );
}

function BusyBlocks() {
  const [branches, setBranches] = useState<any[]>([]), [branchId, setBranchId] = useState(""), [timezone, setTimezone] = useState("UTC");
  const [staff, setStaff] = useState<any[]>([]), [rowsValue, setRows] = useState<any[]>([]), [state, setState] = useState<State>("loading"), [error, setError] = useState(""), [message, setMessage] = useState("");
  const intentKeys = useRef<{ create?: string; cancel: Record<string, string> }>({ cancel: {} });
  useEffect(() => {
    let cancelled = false;
    void getAuthorizedBranchContext().then(({ branches: authorizedBranches, branchId: selected }) => {
      if (cancelled) return;
      setBranches(authorizedBranches);
      setBranchId(selected ?? "");
      setTimezone(authorizedBranches.find((branch) => branch.id === selected)?.timezone ?? "UTC");
    }).catch((cause: any) => { if (!cancelled) { setError(cause?.message ?? "Không thể tải chi nhánh"); setState(cause?.forbidden ? "forbidden" : "error"); } });
    const handleBranchChange = (event: Event) => {
      const next = (event as CustomEvent<string | undefined>).detail ?? "";
      const branch = branches.find((item) => item.id === next);
      setBranchId(next); setTimezone(branch?.timezone ?? "UTC");
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange);
    return () => { cancelled = true; window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, handleBranchChange); };
  }, [branches]);
  const load = useCallback(async () => {
    if (!branchId) { setState("empty"); return; }
    setState("loading"); setError("");
    try { const data = await request(`/v1/availability-blocks?branchId=${encodeURIComponent(branchId)}&status=ACTIVE`); const next = rows(data); setRows(next); setState(next.length ? "ready" : "empty"); }
    catch (cause: any) { setError(cause?.message ?? "Không thể tải busy block"); setState(cause?.forbidden ? "forbidden" : "error"); }
  }, [branchId]);
  useEffect(() => { void load(); if (branchId) void request(`/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(branchId)}`).then((data) => setStaff(rows(data))).catch(() => undefined); }, [branchId, load]);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const startAt = String(form.get("startAt") ?? ""), endAt = String(form.get("endAt") ?? "");
    if (!branchId || !startAt || !endAt) return;
    try { await command("/v1/availability-blocks", { branchId, staffId: form.get("staffId") || null, blockType: "MANUAL", title: form.get("title"), startAt: zonedDateTimeToIso(startAt.slice(0, 10), startAt.slice(11), timezone), endAt: zonedDateTimeToIso(endAt.slice(0, 10), endAt.slice(11), timezone) }, intentKeys.current.create ?? (intentKeys.current.create = crypto.randomUUID())); setMessage("Đã tạo busy block và cập nhật availability."); delete intentKeys.current.create; await load(); }
    catch (cause: any) { setError(cause?.code === "BUSY_BLOCK_VERSION_CONFLICT" ? "Busy block bị thay đổi. Hãy tải lại." : cause?.message ?? "Không thể tạo busy block"); setState(cause?.forbidden ? "forbidden" : "error"); }
  };
  const cancel = async (item: any) => { try { await command(`/v1/availability-blocks/${item.id}/cancel`, { version: item.version }, intentKeys.current.cancel[item.id] ?? (intentKeys.current.cancel[item.id] = crypto.randomUUID())); setMessage("Đã hủy busy block."); delete intentKeys.current.cancel[item.id]; await load(); } catch (cause: any) { setError(cause?.message ?? "Không thể hủy busy block"); } };
  return <Shell eyebrow="Busy block" title="Chặn thời gian vận hành" description="Một block chỉ ảnh hưởng staff/resource trong đúng chi nhánh và được phản ánh vào availability." actions={<a className="s19-button s19-button-secondary" href="/admin/availability/search">Kiểm tra availability</a>}><div className="s19-two-column"><form className="s19-form-card" onSubmit={create}><Field label="Chi nhánh"><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setTimezone(branches.find((branch) => branch.id === event.target.value)?.timezone ?? "UTC"); setActiveBranchId(event.target.value || undefined); }} required><option value="">Chọn chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name ?? branch.code}</option>)}</select></Field><Field label="Nhân sự"><select name="staffId"><option value="">Toàn chi nhánh</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field><Field label="Tiêu đề"><input name="title" defaultValue="Đào tạo nội bộ" required /></Field><Field label={`Bắt đầu · ${timezone}`}><input name="startAt" type="datetime-local" required /></Field><Field label={`Kết thúc · ${timezone}`}><input name="endAt" type="datetime-local" required /></Field><button aria-label="Create manual block" className="s19-button s19-button-primary">Tạo busy block</button></form><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">Đã tạo</p><h2>Ảnh hưởng availability</h2></div></div>{message ? <Notice>{message}</Notice> : null}<StatePanel state={state} error={error} retry={load} label="busy block" />{state === "ready" ? <div className="s19-item-list">{rowsValue.map((item) => <article className="s19-item" key={item.id}><div><strong>{item.title}</strong><span>{item.staffId ?? "Toàn chi nhánh"} · {item.status}</span></div><button className="s19-button s19-button-danger" onClick={() => void cancel(item)}>Hủy</button></article>)}</div> : null}</section></div></Shell>;
}

function WalkInCreate() {
  const lookup = useLookups(), [branchId, setBranchId] = useState(""), [message, setMessage] = useState(""), [saving, setSaving] = useState(false), intentKey = useRef<string | undefined>(undefined);
  useEffect(() => { if (!branchId && lookup.branches[0]?.id) setBranchId(lookup.branches[0].id); }, [branchId, lookup.branches]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (saving) return; setSaving(true); const form = new FormData(event.currentTarget); try { const item = await command("/v1/walk-ins", { branchId, displayName: form.get("displayName"), phone: form.get("phone") || undefined, note: form.get("note") || undefined, items: [{ serviceId: form.get("serviceId"), staffPreference: { type: "ANY" } }] }, intentKey.current ?? (intentKey.current = crypto.randomUUID())); intentKey.current = undefined; location.href = `/admin/operations/walk-ins/${item.id}`; } catch (cause: any) { setMessage(cause?.message ?? "Không thể tạo walk-in"); } finally { setSaving(false); } };
  return <Shell accessibilityTitle="Register walk-in" eyebrow="Walk-in" title="Tiếp nhận khách tại quầy" description="Tạo queue entry nhanh, hiển thị ETA là estimate và chuyển đổi qua Booking Engine khi có slot."><StatePanel state={lookup.state} error={lookup.error} retry={lookup.load} label="danh mục" />{message ? <Notice tone={message.startsWith("Đã") ? "success" : "error"}>{message}</Notice> : null}<form className="s19-form-card" onSubmit={submit}><div className="s19-form-grid"><Field label="Chi nhánh"><select aria-label="Branch" name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Chọn chi nhánh</option>{lookup.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Tên hiển thị"><input aria-label="Display name" name="displayName" required maxLength={200} /></Field><Field label="Số điện thoại (tùy chọn)"><input name="phone" inputMode="tel" maxLength={32} /></Field><Field label="Dịch vụ yêu cầu"><select aria-label="Service" name="serviceId" required><option value="">Chọn dịch vụ</option>{lookup.services.map((item) => <option key={item.id} value={item.id}>{labelOf(item)} · {item.defaultDurationMin ?? "—"} phút</option>)}</select></Field><Field label="Ghi chú"><textarea name="note" rows={3} maxLength={1000} /></Field></div><p className="s19-helper">ETA là estimate, không phải reservation. Không có hard conflict nào được override.</p><button aria-label="Create queue entry" className="s19-button s19-button-primary" disabled={saving}>{saving ? "Đang tạo…" : "Thêm vào hàng đợi"}</button></form></Shell>;
}

function QueueBoard() {
  const branch = useRemote("/v1/branches"), [selectedBranch, setSelectedBranch] = useState(""), board = useRemote(selectedBranch ? `/v1/operations/board?branchId=${selectedBranch}` : null);
  useEffect(() => { if (!selectedBranch && rows(branch.data)[0]?.id) setSelectedBranch(rows(branch.data)[0].id); }, [selectedBranch, branch.data]);
  const columns = ["UPCOMING", "ARRIVED", "WAITING", "IN_SERVICE", "PARTIALLY_COMPLETED", "READY_FOR_CHECKOUT"];
  const columnLabels: Record<string, string> = { UPCOMING: "Sắp tới", ARRIVED: "Đã đến", WAITING: "Đang chờ", IN_SERVICE: "Đang phục vụ", PARTIALLY_COMPLETED: "Đang hoàn tất", READY_FOR_CHECKOUT: "Chờ thanh toán" };
  const statusLabels: Record<string, string> = { UPCOMING: "Sắp tới", ARRIVED: "Đã đến", WAITING: "Đang chờ", IN_SERVICE: "Đang phục vụ", PARTIALLY_COMPLETED: "Đang hoàn tất", READY_FOR_CHECKOUT: "Chờ thanh toán" };
  return <Shell accessibilityTitle="Operational board" eyebrow="Hàng đợi" title="Điều phối salon theo thời gian thực" description="Realtime chỉ là tín hiệu tải lại; PostgreSQL vẫn là nguồn sự thật." actions={<a className="s19-button s19-button-primary" href="/admin/operations/walk-ins/new">+ Tạo walk-in</a>}><div className="s19-toolbar"><Field label="Chi nhánh"><select aria-label="Branch" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}><option value="">Chọn chi nhánh</option>{rows(branch.data).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><button className="s19-button s19-button-secondary" onClick={board.load}>Làm mới bảng</button><span className="s19-live-indicator"><span />Tự động tải lại</span></div><p className="s19-helper">Phiên bản dữ liệu: tín hiệu tải lại từ PostgreSQL</p><StatePanel state={board.state} error={board.error} retry={board.load} label="bảng vận hành" />{board.state === "ready" ? <div className="s19-board-grid">{columns.map((column) => <section className="s19-board-column" key={column}><header><div><span className="s19-column-kicker">{column === "WAITING" ? "Hàng đợi" : "Lịch vận hành"}</span><h2>{columnLabels[column] ?? column}</h2></div><span>{board.data?.columns?.[column]?.length ?? 0}</span></header>{(board.data?.columns?.[column] ?? []).map((item: any) => <article className="s19-board-card" key={item.id}><div className="s19-board-card-top"><strong>{item.bookingReference ?? `#${item.queueNumber ?? "—"}`}</strong><span className="s19-status s19-status-info">{statusLabels[item.status] ?? item.status}</span></div><h3>{item.customerDisplayName ?? item.displayName ?? "Khách hàng"}</h3><p>{item.serviceName ?? item.services?.[0]?.name ?? "Dịch vụ"}</p><small>{item.startAt ? new Date(item.startAt).toLocaleTimeString("vi-VN") : item.estimatedWaitMinutes != null ? `Dự kiến ${item.estimatedWaitMinutes} phút` : "Chưa có dự kiến"}</small><a className="s19-inline-action" href={item.sessionId ? `/admin/service-sessions/${item.sessionId}` : `/admin/appointments/${item.id}/overview`}>Mở chi tiết →</a></article>)}{!(board.data?.columns?.[column] ?? []).length ? <p className="s19-column-empty">Không có bản ghi</p> : null}</section>)}</div> : null}</Shell>;
}

function WalkInDetail({ id }: { id: string }) {
  const walkIn = useRemote(`/v1/walk-ins/${id}`), [message, setMessage] = useState(""), [saving, setSaving] = useState(false), intentKeys = useRef<Record<string, string>>({});
  const intentKeyFor = (name: string) => intentKeys.current[name] ?? (intentKeys.current[name] = crypto.randomUUID());
  const action = async (name: string, extra: any = {}) => { if (!walkIn.data || saving) return; setSaving(true); try { const result = name === "convert" ? await command(`/v1/walk-ins/${id}/conversion-holds`, {}, intentKeyFor("conversion-hold")).then((hold) => command(`/v1/walk-ins/${id}/convert`, { version: walkIn.data.version, holdId: hold.holdId }, intentKeyFor("convert"))) : await command(`/v1/walk-ins/${id}/${name}`, { version: walkIn.data.version, ...extra }, intentKeyFor(name)); setMessage(name === "convert" ? `Đã chuyển thành appointment ${result.appointmentId}.` : "Đã cập nhật hàng đợi."); delete intentKeys.current[name]; if (name === "convert") { delete intentKeys.current["conversion-hold"]; delete intentKeys.current.convert; } await walkIn.load(); } catch (cause: any) { setMessage(cause?.code === "VERSION_CONFLICT" ? "Queue entry đã thay đổi. Đã tải lại." : cause?.message ?? "Không thể cập nhật"); await walkIn.load(); } finally { setSaving(false); } };
  return <Shell eyebrow="Walk-in detail" title={`Queue #${walkIn.data?.queueNumber ?? "—"}`} description="Theo dõi trạng thái, ETA và chuyển đổi qua Booking Engine."><StatePanel state={walkIn.state} error={walkIn.error} retry={walkIn.load} label="walk-in" />{message ? <Notice tone={message.startsWith("Đã") ? "success" : "error"}>{message}</Notice> : null}{walkIn.state === "ready" ? <div className="s19-detail-layout"><section className="s19-card"><div className="s19-card-heading"><div><p className="s19-eyebrow">Khách tại quầy</p><h2>{walkIn.data.contact?.displayName ?? walkIn.data.customerDisplayName}</h2></div><p className="s19-status s19-status-info">{walkIn.data.status}</p></div><dl className="s19-summary-grid"><div><dt>ETA</dt><dd>{walkIn.data.estimatedWaitMinutes ?? "—"} phút · estimate</dd></div><div><dt>Vị trí</dt><dd>{walkIn.data.queuePosition ?? "—"}</dd></div><div><dt>Ưu tiên</dt><dd>{walkIn.data.priority ?? "NORMAL"}</dd></div></dl><ul className="s19-service-list">{(walkIn.data.items ?? []).map((item: any) => <li key={item.id}>{labelOf(item.service)}</li>)}</ul></section><section className="s19-card"><p className="s19-eyebrow">Actions</p><div className="s19-action-stack">{walkIn.data.status === "WAITING" ? <button className="s19-button s19-button-primary" disabled={saving} aria-label="Ready" onClick={() => void action("ready")}>Sẵn sàng</button> : null}{walkIn.data.status === "READY" ? <button className="s19-button s19-button-primary" disabled={saving} aria-label="Call" onClick={() => void action("call")}>Gọi khách</button> : null}{["READY", "CALLED"].includes(walkIn.data.status) ? <button className="s19-button s19-button-secondary" disabled={saving} onClick={() => void action("convert")}>Chuyển thành appointment</button> : null}{["WAITING", "READY"].includes(walkIn.data.status) ? <button className="s19-button s19-button-danger" disabled={saving} onClick={() => void action("cancel", { reasonCode: "CUSTOMER_REQUEST" })}>Hủy queue entry</button> : null}</div></section></div> : null}</Shell>;
}

export function isWave1RemediationPath(pathname: string) {
  return pathname === "/admin/appointments/new" || pathname.startsWith("/admin/appointments/") || pathname.startsWith("/admin/scheduling/blocks") || pathname.startsWith("/admin/operations") || pathname.startsWith("/admin/service-sessions/");
}

export default function Sprint19Wave1Remediation({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/admin/appointments/new") return <CreateAppointmentPage />;
  if (pathname.startsWith("/admin/appointments/")) { const id = parts[2] ?? ""; const tab = parts[3] ?? "overview"; if (tab === "reschedule") return <AppointmentReschedulePage appointmentId={id} />; if (tab === "cancel") return <AppointmentCancelPage appointmentId={id} />; if (tab === "check-in") return <AppointmentCheckInPage appointmentId={id} />; if (tab === "add-service") return <AppointmentAddServicePage appointmentId={id} />; if (tab === "checkout-summary") return <AppointmentCheckoutSummaryPage appointmentId={id} />; return <AppointmentDetailPage id={id} tab={tab} />; }
  if (pathname.startsWith("/admin/scheduling/blocks")) return <BusyBlocks />;
  if (pathname === "/admin/operations/walk-ins/new") return <WalkInCreate />;
  if (pathname.startsWith("/admin/operations/walk-ins/")) return <WalkInDetail id={parts[3] ?? ""} />;
  if (pathname.startsWith("/admin/operations")) return <QueueBoard />;
  if (pathname.startsWith("/admin/service-sessions/")) return <ServiceSessionPage sessionId={parts[2] ?? ""} />;
  return null;
}
