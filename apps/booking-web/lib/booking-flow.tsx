/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type State = "loading" | "ready" | "empty" | "error" | "offline";

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu"),
      { code: body.error?.code, details: body.error?.details },
    );
  return body.data;
}

function localName(value: any) {
  return value?.["vi-VN"] ?? value?.["en-US"] ?? "Dịch vụ";
}

export default function BookingFlow({ salonSlug }: { salonSlug: string }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [salon, setSalon] = useState<any>();
  const [branches, setBranches] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<any[]>([]);
  const [branch, setBranch] = useState<any>();
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<any>();
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<any>();
  const [hold, setHold] = useState<any>();
  const [remaining, setRemaining] = useState(0);
  const [contact, setContact] = useState({
    displayName: "",
    phone: "",
    email: "",
    locale: "vi-VN",
  });
  const [challenge, setChallenge] = useState<any>();
  const [code, setCode] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [result, setResult] = useState<any>();
  const keys = useRef({ hold: "", booking: "" });

  useEffect(() => {
    void loadSalon();
  }, [salonSlug]);

  useEffect(() => {
    if (!hold?.expiresAt) return;
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(seconds);
      if (!seconds) {
        setHold(undefined);
        setSlot(undefined);
        setError("Thời gian giữ chỗ đã hết. Vui lòng chọn lại giờ.");
        setState("error");
        setStep(3);
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hold?.expiresAt]);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>(
      staffDirectory.map((staff) => [staff.id, staff.displayName]),
    );
    for (const candidate of availability?.days?.flatMap((day: any) =>
      day.slots.flatMap(
        (candidateSlot: any) => candidateSlot.staffCandidates ?? [],
      ),
    ) ?? [])
      map.set(candidate.staffId, candidate.displayName);
    return [...map].map(([id, name]) => ({ id, name }));
  }, [availability, staffDirectory]);

  async function loadSalon() {
    setState("loading");
    setError("");
    try {
      const [profile, branchRows] = await Promise.all([
        call(`/v1/public/salons/${salonSlug}`),
        call(`/v1/public/salons/${salonSlug}/branches`),
      ]);
      setSalon(profile);
      setBranches(branchRows);
      setState(branchRows.length ? "ready" : "empty");
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function chooseBranch(value: any) {
    setBranch(value);
    setDate(value.bookingWindow.earliestDate);
    setSelectedServices([]);
    setStaffId("");
    setState("loading");
    try {
      const [rows, staff] = await Promise.all([
        call(`/v1/public/salons/${salonSlug}/services?branchId=${value.id}`),
        call(`/v1/public/salons/${salonSlug}/staff?branchId=${value.id}`),
      ]);
      setServices(rows);
      setStaffDirectory(staff);
      setState(rows.length ? "ready" : "empty");
      setStep(2);
    } catch (cause: any) {
      fail(cause);
    }
  }

  function toggleService(service: any) {
    setSelectedServices((current) => {
      if (current.some((item) => item.id === service.id))
        return current.filter((item) => item.id !== service.id);
      if (current.length >= Number(branch.policy.maxItems)) return current;
      return [...current, service];
    });
  }

  function moveService(index: number, offset: number) {
    setSelectedServices((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function findSlots() {
    if (!selectedServices.length || !date) return;
    if (!branch.policy.allowAnyTechnician && !staffId) {
      setError("Bạn phải chọn một kỹ thuật viên cho chi nhánh này.");
      return;
    }
    setState("loading");
    setError("");
    try {
      const first = selectedServices[0];
      const params = new URLSearchParams({
        branchId: branch.id,
        serviceId: first.id,
        dateFrom: date,
        dateTo: date,
        slotIntervalMin: "15",
      });
      if (staffId) params.set("staffId", staffId);
      const data = await call(
        `/v1/public/salons/${salonSlug}/availability?${params}`,
      );
      setAvailability(data);
      setState(
        data.days.some((day: any) => day.slots.length) ? "ready" : "empty",
      );
      setStep(3);
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function publicPlan(firstSlot: any) {
    const items: any[] = [];
    let cursor = new Date(firstSlot.startAt);
    const dataVersion = Number(availability.dataVersion);
    for (let index = 0; index < selectedServices.length; index += 1) {
      const service = selectedServices[index];
      if (index > 0) {
        const previous = selectedServices[index - 1];
        cursor = new Date(
          cursor.getTime() +
            (Number(previous.durationMin) +
              Number(previous.cleanupTimeMin) +
              Number(previous.bufferAfterMin) +
              Number(service.prepTimeMin) +
              Number(service.bufferBeforeMin)) *
              60_000,
        );
      }
      let candidate = index === 0 ? firstSlot : undefined;
      if (index > 0) {
        const parts = new Intl.DateTimeFormat("en", {
          timeZone: branch.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(cursor)
          .reduce<Record<string, string>>((result, part) => {
            result[part.type] = part.value;
            return result;
          }, {});
        const serviceDate = `${parts.year}-${parts.month}-${parts.day}`;
        const params = new URLSearchParams({
          branchId: branch.id,
          serviceId: service.id,
          dateFrom: serviceDate,
          dateTo: serviceDate,
          slotIntervalMin: "5",
        });
        if (staffId) params.set("staffId", staffId);
        const data = await call(
          `/v1/public/salons/${salonSlug}/availability?${params}`,
        );
        if (Number(data.dataVersion) !== dataVersion)
          throw Object.assign(new Error("Lịch trống vừa thay đổi."), {
            code: "AVAILABILITY_CHANGED",
          });
        candidate = data.days
          .flatMap((day: any) => day.slots)
          .find((value: any) => value.startAt === cursor.toISOString());
      }
      if (!candidate)
        throw Object.assign(
          new Error(
            `Không đủ thời gian liên tục cho ${localName(service.name)}.`,
          ),
          { code: "SLOT_UNAVAILABLE" },
        );
      items.push({
        serviceId: service.id,
        staffPreference: staffId
          ? { type: "SPECIFIC", staffId }
          : { type: "ANY" },
        availabilityFingerprint: candidate.fingerprint,
      });
    }
    return { items, dataVersion };
  }

  async function selectSlot(value: any) {
    setSlot(value);
    setState("loading");
    setError("");
    try {
      const plan = await publicPlan(value);
      keys.current.hold ||= crypto.randomUUID();
      const data = await call(`/v1/public/salons/${salonSlug}/slot-holds`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keys.current.hold,
        },
        body: JSON.stringify({
          branchId: branch.id,
          desiredStartAt: value.startAt,
          availabilityDataVersion: plan.dataVersion,
          clientKey: getClientKey(),
          items: plan.items,
        }),
      });
      setHold(data);
      setState("ready");
      setStep(4);
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hold) return;
    setState("loading");
    try {
      const data = await call(
        `/v1/public/salons/${salonSlug}/contact-verification/request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contact: contact.phone || contact.email,
            channel: contact.phone ? "SMS" : "EMAIL",
          }),
        },
      );
      setChallenge(data);
      setCode(data.testCode ?? "");
      setState("ready");
      setStep(5);
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function verify() {
    setState("loading");
    try {
      const data = await call(
        `/v1/public/salons/${salonSlug}/contact-verification/verify`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId: challenge.challengeId, code }),
        },
      );
      setVerificationToken(data.verificationToken);
      setState("ready");
      setStep(6);
    } catch (cause: any) {
      fail(cause);
    }
  }

  async function create() {
    if (!policyAccepted) {
      setError("Bạn phải đồng ý với chính sách đặt và hủy lịch.");
      return;
    }
    if (!navigator.onLine) return setState("offline");
    setState("loading");
    try {
      keys.current.booking ||= crypto.randomUUID();
      const data = await call(`/v1/public/salons/${salonSlug}/bookings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keys.current.booking,
        },
        body: JSON.stringify({
          holdId: hold.holdId,
          holdToken: hold.holdToken,
          contactVerificationToken: verificationToken,
          customer: {
            displayName: contact.displayName,
            locale: contact.locale,
            ...(contact.phone.trim() ? { phone: contact.phone } : {}),
            ...(contact.email.trim() ? { email: contact.email } : {}),
          },
          marketingConsent,
          acceptedPolicyVersion: branch.policy.version,
          acceptedAt: new Date().toISOString(),
        }),
      });
      setResult(data);
      setState("ready");
      setStep(7);
    } catch (cause: any) {
      if (["SLOT_HOLD_EXPIRED", "AVAILABILITY_CHANGED"].includes(cause.code)) {
        setHold(undefined);
        setSlot(undefined);
        setStep(3);
      }
      if (cause.code === "BOOKING_POLICY_CHANGED") setPolicyAccepted(false);
      fail(cause);
    }
  }

  function fail(cause: any) {
    setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`);
    setState(!navigator.onLine ? "offline" : "error");
  }

  const visibleSlots =
    availability?.days
      ?.flatMap((day: any) => day.slots)
      .filter(
        (candidate: any) =>
          !staffId ||
          candidate.staffCandidates?.some(
            (staff: any) => staff.staffId === staffId,
          ),
      ) ?? [];

  return (
    <main className="booking-shell">
      <header className="brand">
        <a href="/">NAILSOFT</a>
        <a href={`/manage-booking?salon=${encodeURIComponent(salonSlug)}`}>
          Quản lý lịch hẹn
        </a>
      </header>
      <section className="hero">
        <p>BOOKING · {salon?.name ?? salonSlug}</p>
        <h1>Chọn dịch vụ của bạn.</h1>
        <p className="muted">
          Múi giờ: {branch?.timezone ?? salon?.timezone ?? "đang tải"}
        </p>
      </section>
      <section className="card">
        <ol className="steps" aria-label="Tiến trình đặt lịch">
          {[
            "Chi nhánh",
            "Dịch vụ",
            "Thời gian",
            "Liên hệ",
            "Xác minh",
            "Xem lại",
            "Hoàn tất",
          ].map((label, index) => (
            <li className={step === index + 1 ? "active" : ""} key={label}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>
        {hold && (
          <p className="countdown">
            Giữ chỗ còn {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </p>
        )}
        <StatePanel
          state={state}
          error={error}
          retry={() => void loadSalon()}
        />

        {state === "ready" && step === 1 && (
          <div className="grid">
            {branches.map((item) => (
              <button
                className="choice"
                key={item.id}
                onClick={() => void chooseBranch(item)}
              >
                <strong>{item.name}</strong>
                <small>
                  {item.code} · {item.timezone}
                </small>
              </button>
            ))}
          </div>
        )}

        {state === "ready" && step === 2 && (
          <div className="grid">
            <p className="muted">
              Chọn tối đa {branch.policy.maxItems} dịch vụ. Thứ tự bên dưới là
              thứ tự thực hiện.
            </p>
            {services.map((item) => (
              <button
                className={`choice ${selectedServices.some((value) => value.id === item.id) ? "selected" : ""}`}
                key={item.id}
                aria-pressed={selectedServices.some(
                  (value) => value.id === item.id,
                )}
                onClick={() => toggleService(item)}
              >
                <strong>{localName(item.name)}</strong>
                <span>
                  {item.durationMin} phút · {item.price.amount}{" "}
                  {item.price.currency}
                </span>
              </button>
            ))}
            {selectedServices.length > 0 && (
              <div className="summary">
                <strong>Dịch vụ đã chọn</strong>
                {selectedServices.map((item, index) => (
                  <div className="ordered-item" key={item.id}>
                    <span>
                      {index + 1}. {localName(item.name)}
                    </span>
                    <span>
                      <button
                        className="compact"
                        onClick={() => moveService(index, -1)}
                        aria-label={`Đưa ${localName(item.name)} lên`}
                      >
                        ↑
                      </button>
                      <button
                        className="compact"
                        onClick={() => moveService(index, 1)}
                        aria-label={`Đưa ${localName(item.name)} xuống`}
                      >
                        ↓
                      </button>
                      <button
                        className="compact"
                        onClick={() => toggleService(item)}
                      >
                        Xóa
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <label className="field">
              Ngày hẹn ({branch.timezone})
              <input
                type="date"
                required
                min={branch.bookingWindow.earliestDate}
                max={branch.bookingWindow.latestDate}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            {branch.policy.allowCustomerSelectStaff &&
              !branch.policy.hideStaffNames &&
              staffOptions.length > 0 && (
                <label className="field">
                  Kỹ thuật viên
                  <select
                    required={!branch.policy.allowAnyTechnician}
                    value={staffId}
                    onChange={(event) => setStaffId(event.target.value)}
                  >
                    {branch.policy.allowAnyTechnician && (
                      <option value="">Bất kỳ kỹ thuật viên phù hợp</option>
                    )}
                    {!branch.policy.allowAnyTechnician && (
                      <option value="">Chọn kỹ thuật viên</option>
                    )}
                    {staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            <button
              className="primary"
              disabled={
                !selectedServices.length ||
                (!branch.policy.allowAnyTechnician && !staffId)
              }
              onClick={() => void findSlots()}
            >
              Tìm giờ trống
            </button>
          </div>
        )}

        {state === "ready" && step === 3 && (
          <div className="grid">
            <h2>Giờ còn trống</h2>
            {branch.policy.allowCustomerSelectStaff &&
              !branch.policy.hideStaffNames &&
              staffOptions.length > 0 && (
                <label className="field">
                  Kỹ thuật viên
                  <select
                    value={staffId}
                    onChange={(event) => setStaffId(event.target.value)}
                  >
                    {branch.policy.allowAnyTechnician && (
                      <option value="">Bất kỳ kỹ thuật viên phù hợp</option>
                    )}
                    {staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            <div className="slots">
              {visibleSlots.map((item: any) => (
                <button
                  className="choice"
                  key={item.fingerprint}
                  onClick={() => void selectSlot(item)}
                >
                  <strong>
                    {new Date(item.startAt).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: branch.timezone,
                    })}
                  </strong>
                  <small>
                    {staffId
                      ? staffOptions.find((staff) => staff.id === staffId)?.name
                      : "Bất kỳ kỹ thuật viên phù hợp"}
                  </small>
                </button>
              ))}
            </div>
            {!visibleSlots.length && (
              <div className="state">
                Không còn giờ phù hợp với lựa chọn này.
              </div>
            )}
            <button className="secondary" onClick={() => setStep(2)}>
              Đổi dịch vụ hoặc ngày
            </button>
          </div>
        )}

        {state === "ready" && step === 4 && (
          <form className="grid" onSubmit={requestCode}>
            <h2>Thông tin liên hệ</h2>
            <label className="field">
              Họ tên
              <input
                required
                value={contact.displayName}
                onChange={(event) =>
                  setContact({ ...contact, displayName: event.target.value })
                }
              />
            </label>
            <label className="field">
              Số điện thoại
              <input
                required
                inputMode="tel"
                value={contact.phone}
                onChange={(event) =>
                  setContact({ ...contact, phone: event.target.value })
                }
              />
            </label>
            <label className="field">
              Email (không bắt buộc)
              <input
                type="email"
                value={contact.email}
                onChange={(event) =>
                  setContact({ ...contact, email: event.target.value })
                }
              />
            </label>
            <button className="primary">Gửi mã xác minh</button>
          </form>
        )}

        {state === "ready" && step === 5 && (
          <div className="grid">
            <h2>Nhập mã gồm 6 số</h2>
            <label className="field">
              Mã xác minh
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <p className="muted">Mã hết hạn sau 5 phút.</p>
            <button
              className="primary"
              disabled={!/^\d{6}$/.test(code)}
              onClick={() => void verify()}
            >
              Xác minh
            </button>
          </div>
        )}

        {state === "ready" && step === 6 && (
          <div className="grid">
            <h2>Xem lại lịch hẹn</h2>
            <div className="summary">
              {selectedServices.map((item, index) => (
                <strong key={item.id}>
                  {index + 1}. {localName(item.name)}
                </strong>
              ))}
              <span>{branch.name}</span>
              <span>
                {new Date(slot.startAt).toLocaleString("vi-VN", {
                  timeZone: branch.timezone,
                })}{" "}
                ({branch.timezone})
              </span>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                required
                checked={policyAccepted}
                onChange={(event) => setPolicyAccepted(event.target.checked)}
              />
              <span>
                Tôi đã đọc và đồng ý với{" "}
                <a href={branch.policy.documentUrl ?? "#policy"}>
                  chính sách đặt và hủy lịch phiên bản {branch.policy.version}
                </a>
                . {branch.policy.summary}
              </span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(event) => setMarketingConsent(event.target.checked)}
              />
              <span>Tôi đồng ý nhận thông tin ưu đãi (không bắt buộc).</span>
            </label>
            <div className="actions">
              <button className="secondary" onClick={() => setStep(3)}>
                Chọn giờ khác
              </button>
              <button
                className="primary"
                disabled={!policyAccepted}
                onClick={() => void create()}
              >
                Xác nhận đặt lịch
              </button>
            </div>
          </div>
        )}

        {state === "ready" && step === 7 && result && (
          <div className="success" tabIndex={-1}>
            <h2>Đặt lịch thành công</h2>
            <p>
              Mã lịch hẹn: <strong>{result.bookingReference}</strong>
            </p>
            <p>
              {new Date(result.startAt).toLocaleString("vi-VN", {
                timeZone: branch.timezone,
              })}{" "}
              · {result.status}
            </p>
            <a href={`/manage-booking?salon=${encodeURIComponent(salonSlug)}`}>
              Quản lý lịch hẹn
            </a>
          </div>
        )}
      </section>
    </main>
  );
}

function StatePanel({
  state,
  error,
  retry,
}: {
  state: State;
  error: string;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className="state" role="status">
        Đang tải…
      </div>
    );
  if (state === "offline")
    return (
      <div className="error error-summary" role="alert">
        <strong>Cần kết nối Internet</strong>
        <p>Không thể gửi lệnh đặt lịch khi ngoại tuyến.</p>
        <button className="secondary" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "error")
    return (
      <div className="error error-summary" role="alert">
        <strong>Không thể tiếp tục</strong>
        <p>{error}</p>
        <button className="secondary" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "empty")
    return (
      <div className="state">
        <strong>Chưa có lựa chọn phù hợp</strong>
        <p>Thử ngày, dịch vụ hoặc chi nhánh khác.</p>
      </div>
    );
  return null;
}

function getClientKey() {
  const key = "nailsoft-booking-client";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}
