/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type State = "loading" | "ready" | "empty" | "error" | "offline";
async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init),
    body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu"),
      { code: body.error?.code },
    );
  return body.data;
}

export default function BookingFlow({ salonSlug }: { salonSlug: string }) {
  const [state, setState] = useState<State>("loading"),
    [error, setError] = useState(""),
    [step, setStep] = useState(1);
  const [salon, setSalon] = useState<any>(),
    [branches, setBranches] = useState<any[]>([]),
    [services, setServices] = useState<any[]>([]),
    [branch, setBranch] = useState<any>(),
    [service, setService] = useState<any>(),
    [availability, setAvailability] = useState<any>(),
    [slot, setSlot] = useState<any>();
  const [hold, setHold] = useState<any>(),
    [remaining, setRemaining] = useState(0),
    [contact, setContact] = useState({
      displayName: "",
      phone: "",
      email: "",
      locale: "vi-VN",
    }),
    [challenge, setChallenge] = useState<any>(),
    [code, setCode] = useState(""),
    [verificationToken, setVerificationToken] = useState(""),
    [marketingConsent, setMarketingConsent] = useState(false),
    [result, setResult] = useState<any>();
  const keys = useRef({ hold: "", booking: "" });

  useEffect(() => {
    void (async () => {
      try {
        const [profile, branchRows] = await Promise.all([
          call(`/v1/public/salons/${salonSlug}`),
          call(`/v1/public/salons/${salonSlug}/branches`),
        ]);
        setSalon(profile);
        setBranches(branchRows);
        setState(branchRows.length ? "ready" : "empty");
      } catch (cause: any) {
        setError(cause.message);
        setState("error");
      }
    })();
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
        setStep(3);
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hold?.expiresAt]);

  async function chooseBranch(value: any) {
    setBranch(value);
    setState("loading");
    try {
      const rows = await call(
        `/v1/public/salons/${salonSlug}/services?branchId=${value.id}`,
      );
      setServices(rows);
      setState(rows.length ? "ready" : "empty");
      setStep(2);
    } catch (cause: any) {
      fail(cause);
    }
  }
  async function findSlots(selected: any) {
    setService(selected);
    setState("loading");
    try {
      const today = "2026-08-10";
      const data = await call(
        `/v1/public/salons/${salonSlug}/availability?branchId=${branch.id}&serviceId=${selected.id}&dateFrom=${today}&dateTo=${today}&slotIntervalMin=15`,
      );
      setAvailability(data);
      setState(data.days.some((d: any) => d.slots.length) ? "ready" : "empty");
      setStep(3);
    } catch (cause: any) {
      fail(cause);
    }
  }
  async function selectSlot(value: any) {
    setSlot(value);
    setState("loading");
    try {
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
          availabilityDataVersion: availability.dataVersion,
          clientKey: getClientKey(),
          items: [
            {
              serviceId: service.id,
              staffPreference: { type: "ANY" },
              availabilityFingerprint: value.fingerprint,
            },
          ],
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
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
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
          customer: contact,
          marketingConsent,
          acceptedPolicyVersion: 1,
          confirm: true,
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
      fail(cause);
    }
  }
  function fail(cause: any) {
    setError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`);
    setState(!navigator.onLine ? "offline" : "error");
  }

  return (
    <main className="booking-shell">
      <header className="brand">
        <a href="/">NAILSOFT</a>
        <a href="/manage-booking">Quản lý lịch hẹn</a>
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
          retry={() => location.reload()}
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
            {services.map((item) => (
              <button
                className="choice"
                key={item.id}
                onClick={() => void findSlots(item)}
              >
                <strong>{item.name?.["vi-VN"] ?? item.name?.["en-US"]}</strong>
                <span>{item.durationMin} phút</span>
                <small>
                  {item.price.amount} {item.price.currency}
                </small>
              </button>
            ))}
          </div>
        )}
        {state === "ready" && step === 3 && (
          <div>
            <h2>Giờ còn trống</h2>
            <div className="slots">
              {availability?.days
                .flatMap((day: any) => day.slots)
                .map((item: any) => (
                  <button
                    className="choice"
                    key={item.fingerprint}
                    onClick={() => void selectSlot(item)}
                  >
                    <strong>
                      {new Date(item.startAt).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </strong>
                    <small>Bất kỳ kỹ thuật viên phù hợp</small>
                  </button>
                ))}
            </div>
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
                onChange={(e) =>
                  setContact({ ...contact, displayName: e.target.value })
                }
              />
            </label>
            <label className="field">
              Số điện thoại
              <input
                required
                inputMode="tel"
                value={contact.phone}
                onChange={(e) =>
                  setContact({ ...contact, phone: e.target.value })
                }
              />
            </label>
            <label className="field">
              Email (không bắt buộc)
              <input
                type="email"
                value={contact.email}
                onChange={(e) =>
                  setContact({ ...contact, email: e.target.value })
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
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <p className="muted">
              Mã hết hạn sau 5 phút. Trong môi trường phát triển, mã kiểm thử
              được điền tự động.
            </p>
            <button className="primary" onClick={() => void verify()}>
              Xác minh
            </button>
          </div>
        )}
        {state === "ready" && step === 6 && (
          <div>
            <h2>Xem lại lịch hẹn</h2>
            <div className="summary">
              <strong>{service.name?.["vi-VN"]}</strong>
              <span>{branch.name}</span>
              <span>
                {new Date(slot.startAt).toLocaleString("vi-VN")} (
                {branch.timezone})
              </span>
              <span>
                {slot.priceReference.amount} {slot.priceReference.currency}
              </span>
              <span>
                Đặt cọc: theo chính sách dịch vụ · Hủy lịch: theo chính sách chi
                nhánh
              </span>
            </div>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                />{" "}
                Tôi đồng ý nhận thông tin ưu đãi (không bắt buộc)
              </span>
            </label>
            <div className="actions">
              <button className="secondary" onClick={() => setStep(3)}>
                Chọn giờ khác
              </button>
              <button className="primary" onClick={() => void create()}>
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
              {new Date(result.startAt).toLocaleString("vi-VN")} ·{" "}
              {result.status}
            </p>
            <a href="/manage-booking">Quản lý lịch hẹn</a>
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
      <div className="error error-summary" role="alert" tabIndex={-1}>
        <strong>Cần kết nối Internet</strong>
        <p>Không thể gửi lệnh đặt lịch khi ngoại tuyến.</p>
        <button className="secondary" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (state === "error")
    return (
      <div className="error error-summary" role="alert" tabIndex={-1}>
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
