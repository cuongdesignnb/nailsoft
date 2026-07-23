/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(body.error?.message ?? "Không thể hoàn tất yêu cầu"),
      { code: body.error?.code },
    );
  return body.data;
}

export default function ManageBooking() {
  const [step, setStep] = useState(1);
  const [salonSlug, setSalonSlug] = useState("");
  const [reference, setReference] = useState("");
  const [contact, setContact] = useState("");
  const [challenge, setChallenge] = useState<any>();
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [booking, setBooking] = useState<any>();
  const [branch, setBranch] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<any>();
  const [selectedSlot, setSelectedSlot] = useState<any>();
  const [replacementHold, setReplacementHold] = useState<any>();
  const keys = useRef({ hold: "", reschedule: "", cancel: "" });

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("salon");
    if (value) setSalonSlug(value);
  }, []);

  function path(suffix: string) {
    return `/v1/public/salons/${encodeURIComponent(salonSlug)}/bookings${suffix}`;
  }

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await call(path("/access/request"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingReference: reference,
          contact,
          channel: contact.includes("@") ? "EMAIL" : "SMS",
        }),
      });
      setChallenge(data);
      setCode(data.testCode ?? "");
      setStep(2);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setLoading(true);
    setError("");
    try {
      const data = await call(path("/access/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const detail = await loadDetail(
        data.bookingReference,
        data.managementToken,
      );
      const branches = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/branches`,
      );
      const selectedBranch = branches.find(
        (item: any) => item.id === detail.branchId,
      );
      setToken(data.managementToken);
      setReference(data.bookingReference);
      setBooking(detail);
      setBranch(selectedBranch);
      setDate(selectedBranch?.bookingWindow?.earliestDate ?? "");
      setStep(3);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(value = reference, capability = token) {
    return call(path(`/${encodeURIComponent(value)}`), {
      headers: { authorization: `Bearer ${capability}` },
    });
  }

  async function findReplacementSlots() {
    const serviceId = booking.items?.[0]?.service?.serviceId;
    if (!serviceId) return setError("Không tìm thấy dịch vụ để đổi lịch.");
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        branchId: booking.branchId,
        serviceId,
        dateFrom: date,
        dateTo: date,
        slotIntervalMin: "15",
      });
      const data = await call(
        `/v1/public/salons/${encodeURIComponent(salonSlug)}/availability?${params}`,
      );
      setAvailability(data);
      setSelectedSlot(undefined);
      setReplacementHold(undefined);
      setStep(4);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  async function holdReplacement(slot: any) {
    setLoading(true);
    setError("");
    try {
      keys.current.hold ||= crypto.randomUUID();
      const data = await call(path(`/${reference}/reschedule-holds`), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": keys.current.hold,
        },
        body: JSON.stringify({
          desiredStartAt: slot.startAt,
          availabilityDataVersion: availability.dataVersion,
          items: booking.items.map((item: any, index: number) => ({
            serviceId: item.service.serviceId,
            staffPreference: branch?.policy?.allowAnyTechnician
              ? { type: "ANY" }
              : { type: "SPECIFIC", staffId: item.staff.id },
            ...(index === 0
              ? { availabilityFingerprint: slot.fingerprint }
              : {}),
          })),
        }),
      });
      setSelectedSlot(slot);
      setReplacementHold(data);
      setStep(5);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmReschedule() {
    if (!navigator.onLine) return setError("Cần kết nối Internet để đổi lịch.");
    setLoading(true);
    setError("");
    try {
      keys.current.reschedule ||= crypto.randomUUID();
      await call(path(`/${reference}/reschedule`), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": keys.current.reschedule,
        },
        body: JSON.stringify({
          version: booking.version,
          replacementHoldId: replacementHold.holdId,
          replacementHoldToken: replacementHold.holdToken,
          reasonCode: "CUSTOMER_REQUEST",
          note: "Customer self-service reschedule",
        }),
      });
      setBooking(await loadDetail());
      setNotice(
        "Đổi lịch thành công. Lịch cũ chỉ được giải phóng sau khi lịch mới được xác nhận.",
      );
      setStep(3);
    } catch (cause: any) {
      setError(
        cause.code === "BOOKING_VERSION_CONFLICT"
          ? "Lịch hẹn đã thay đổi. Vui lòng xác minh và tải lại."
          : cause.message,
      );
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    if (!navigator.onLine) return setError("Cần kết nối Internet để hủy lịch.");
    setLoading(true);
    setError("");
    try {
      keys.current.cancel ||= crypto.randomUUID();
      const data = await call(path(`/${reference}/cancel`), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": keys.current.cancel,
        },
        body: JSON.stringify({
          version: booking.version,
          reasonCode: "CUSTOMER_REQUEST",
          note: "Cancelled from booking management",
        }),
      });
      setBooking(data);
      setNotice("Lịch hẹn đã được hủy và vẫn được lưu trong lịch sử.");
    } catch (cause: any) {
      setError(
        cause.code === "BOOKING_VERSION_CONFLICT"
          ? "Lịch hẹn đã thay đổi. Vui lòng xác minh và tải lại."
          : cause.message,
      );
    } finally {
      setLoading(false);
    }
  }

  const slots = availability?.days?.flatMap((day: any) => day.slots) ?? [];
  return (
    <main className="booking-shell">
      <header className="brand">
        <a href="/">NAILSOFT</a>
        {salonSlug && (
          <a href={`/book/${encodeURIComponent(salonSlug)}`}>Đặt lịch mới</a>
        )}
      </header>
      <section className="hero">
        <p>BOOKING MANAGEMENT</p>
        <h1>Quản lý lịch hẹn.</h1>
      </section>
      <section className="card">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="link-button" onClick={() => setError("")}>
              Thử lại
            </button>
          </div>
        )}
        {notice && (
          <div className="success" role="status">
            {notice}
          </div>
        )}
        {loading && (
          <div className="state" role="status">
            Đang xử lý…
          </div>
        )}

        {step === 1 && (
          <form className="grid" onSubmit={request}>
            <label className="field">
              Mã salon
              <input
                required
                value={salonSlug}
                onChange={(event) => setSalonSlug(event.target.value.trim())}
                placeholder="nailsoft-demo"
              />
            </label>
            <label className="field">
              Mã lịch hẹn
              <input
                required
                value={reference}
                onChange={(event) =>
                  setReference(event.target.value.toUpperCase())
                }
              />
            </label>
            <label className="field">
              Số điện thoại hoặc email
              <input
                required
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </label>
            <button className="primary" disabled={loading}>
              Gửi mã truy cập
            </button>
            <p className="muted">
              Phản hồi luôn trung tính để bảo vệ dữ liệu khách hàng.
            </p>
          </form>
        )}

        {step === 2 && (
          <div className="grid">
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
            <button
              className="primary"
              disabled={!/^\d{6}$/.test(code) || loading}
              onClick={() => void verify()}
            >
              Mở lịch hẹn
            </button>
          </div>
        )}

        {step === 3 && booking && (
          <div className="grid">
            <div className="summary">
              <h2>{booking.bookingReference}</h2>
              <strong>{booking.status}</strong>
              <span>
                {new Date(booking.startAt).toLocaleString("vi-VN", {
                  timeZone: branch?.timezone,
                })}
              </span>
              <span>{booking.contact?.displayName}</span>
              {booking.items?.map((item: any) => (
                <span key={item.id}>
                  {item.sequenceNo}.{" "}
                  {item.service?.name?.["vi-VN"] ?? item.service?.code}
                </span>
              ))}
              <span>Phiên truy cập hết hạn sau 15 phút.</span>
            </div>
            {!String(booking.status).startsWith("CANCELLED") && (
              <div className="actions">
                <label className="field">
                  Ngày mới
                  <input
                    type="date"
                    required
                    min={branch?.bookingWindow?.earliestDate}
                    max={branch?.bookingWindow?.latestDate}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!date || loading}
                  onClick={() => void findReplacementSlots()}
                >
                  Chọn lịch mới
                </button>
                <button
                  className="danger"
                  disabled={loading}
                  onClick={() => void cancel()}
                >
                  Hủy lịch hẹn
                </button>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="grid">
            <h2>Chọn giờ mới</h2>
            {slots.length === 0 ? (
              <div className="state">Không còn giờ phù hợp trong ngày này.</div>
            ) : (
              <div className="slots">
                {slots.map((item: any) => (
                  <button
                    className="choice"
                    key={item.fingerprint}
                    onClick={() => void holdReplacement(item)}
                  >
                    <strong>
                      {new Date(item.startAt).toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: branch?.timezone,
                      })}
                    </strong>
                    <small>Bất kỳ kỹ thuật viên phù hợp</small>
                  </button>
                ))}
              </div>
            )}
            <button className="secondary" onClick={() => setStep(3)}>
              Quay lại
            </button>
          </div>
        )}

        {step === 5 && replacementHold && (
          <div className="grid">
            <h2>Xác nhận đổi lịch</h2>
            <div className="summary">
              <span>
                Lịch hiện tại:{" "}
                {new Date(booking.startAt).toLocaleString("vi-VN", {
                  timeZone: branch?.timezone,
                })}
              </span>
              <strong>
                Lịch mới:{" "}
                {new Date(selectedSlot.startAt).toLocaleString("vi-VN", {
                  timeZone: branch?.timezone,
                })}
              </strong>
              <span>
                Slot mới đang được giữ đến{" "}
                {new Date(replacementHold.expiresAt).toLocaleTimeString(
                  "vi-VN",
                  { timeZone: branch?.timezone },
                )}
                .
              </span>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setStep(4)}>
                Chọn lại
              </button>
              <button
                className="primary"
                disabled={loading}
                onClick={() => void confirmReschedule()}
              >
                Xác nhận đổi lịch
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
