/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "./auth";

type ViewState =
  "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
const defaults = {
  branchId: "20000000-0000-4000-8000-000000000001",
  serviceId: "50000000-0000-4000-8000-000000000001",
  staffId: "47000000-0000-4000-8000-000000000003",
  customerId: "60000000-0000-4000-8000-000000000001",
};

async function request(path: string, init?: RequestInit) {
  const response = await authorizedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403)
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!response.ok)
    throw Object.assign(new Error(body.error?.message ?? "Request failed"), {
      code: body.error?.code,
      status: response.status,
    });
  return body.data;
}
function command(path: string, payload: unknown) {
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
}
function useLoad(path: string) {
  const [state, setState] = useState<ViewState>("loading"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const value = await request(path);
      setData(value);
      setState(Array.isArray(value) && !value.length ? "empty" : "ready");
    } catch (cause: any) {
      setError(cause.message);
      setState(
        cause.forbidden ? "forbidden" : !navigator.onLine ? "offline" : "error",
      );
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, data, error, load, setData, setState, setError };
}

export default function Sprint4Screen({ pathname }: { pathname: string }) {
  if (pathname === "/admin/appointments" || pathname === "/admin/appointments/")
    return <AppointmentList />;
  if (pathname === "/admin/appointments/new") return <QuickCreate />;
  const parts = pathname.split("/").filter(Boolean),
    appointmentId = parts[2] ?? "",
    tab = parts[3] ?? "overview";
  return <AppointmentDetail appointmentId={appointmentId} tab={tab} />;
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="shell">
      <nav className="topbar">
        <a href="/admin/dashboard">Nailsoft</a>
        <a href="/admin/appointments">Appointments</a>
        <a href="/admin/appointments/new">Quick create</a>
        <a href="/admin/calendar/day">Calendar</a>
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 4 · BOOKING OPERATIONS</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              PostgreSQL reservations, audited commands, safe retries and
              realtime refetch.
            </p>
          </div>
          <span className="timezone">Branch timezone</span>
        </div>
        {children}
      </section>
    </main>
  );
}
function States({
  state,
  error,
  retry,
}: {
  state: ViewState;
  error: string;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className="skeleton" role="status">
        Loading appointments…
      </div>
    );
  if (state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Permission denied</h2>
        <p>Your role or branch scope does not allow this operation.</p>
      </div>
    );
  if (state === "offline")
    return (
      <div className="state" role="alert">
        <h2>Internet connection required</h2>
        <p>Critical booking commands are never queued offline.</p>
        <button onClick={retry}>Reconnect</button>
      </div>
    );
  if (state === "error")
    return (
      <div className="state" role="alert">
        <h2>Unable to load</h2>
        <p>{error}</p>
        <button onClick={retry}>Retry</button>
      </div>
    );
  if (state === "empty")
    return (
      <div className="state">
        <h2>No appointments</h2>
        <p>No records match the current filters.</p>
        <button onClick={retry}>Refresh</button>
      </div>
    );
  return null;
}

function AppointmentList() {
  const [query, setQuery] = useState(
    `branchId=${defaults.branchId}&from=2026-07-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00&limit=50`,
  );
  const view = useLoad(`/v1/appointments?${query}`),
    rows = Array.isArray(view.data) ? view.data : [];
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      params = new URLSearchParams();
    for (const key of ["branchId", "from", "to", "status", "search"]) {
      const value = String(form.get(key) ?? "");
      if (value) params.set(key, value);
    }
    params.set("limit", "50");
    setQuery(params.toString());
  }
  return (
    <Shell title="Appointments">
      <form className="toolbar" onSubmit={filter}>
        <label>
          Branch
          <input name="branchId" defaultValue={defaults.branchId} />
        </label>
        <label>
          From
          <input name="from" defaultValue="2026-07-01T00:00:00+07:00" />
        </label>
        <label>
          To
          <input name="to" defaultValue="2026-09-01T00:00:00+07:00" />
        </label>
        <label>
          Status
          <select name="status" defaultValue="">
            <option value="">All</option>
            <option>CONFIRMED</option>
            <option>PENDING_CONFIRMATION</option>
            <option>PENDING_DEPOSIT</option>
            <option>CANCELLED_BY_CUSTOMER</option>
          </select>
        </label>
        <label>
          Customer / phone / reference
          <input name="search" />
        </label>
        <button>Apply</button>
        <a href="/admin/appointments/new">Create appointment</a>
      </form>
      <States state={view.state} error={view.error} retry={view.load} />
      {view.state === "ready" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Deposit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.bookingReference}</strong>
                    <small>{row.customerId}</small>
                  </td>
                  <td>
                    {new Date(row.startAt).toLocaleString("vi-VN")}
                    <small>{row.branchId}</small>
                  </td>
                  <td>{row.status}</td>
                  <td>{row.depositStatus}</td>
                  <td>
                    <a href={`/admin/appointments/${row.id}/overview`}>Open</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Realtime events contain refetch metadata only; reconnecting always
        reloads this list.
      </p>
    </Shell>
  );
}

function QuickCreate() {
  const [step, setStep] = useState(1),
    [slots, setSlots] = useState<any[]>([]),
    [version, setVersion] = useState(0),
    [selected, setSelected] = useState<any>(),
    [state, setState] = useState<ViewState>("ready"),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>();
  const [draft, setDraft] = useState({
    branchId: defaults.branchId,
    customerId: defaults.customerId,
    serviceIds: [defaults.serviceId],
  });
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    const form = new FormData(event.currentTarget),
      serviceIds = String(form.get("serviceIds") ?? "")
        .split(/[\s,]+/)
        .filter(Boolean),
      branchId = String(form.get("branchId")),
      customerId = String(form.get("customerId")),
      date = String(form.get("date"));
    try {
      if (!serviceIds.length) throw new Error("Select at least one service");
      setDraft({ branchId, customerId, serviceIds });
      const data = await request(
        `/v1/availability?branchId=${branchId}&serviceId=${serviceIds[0]}&dateFrom=${date}&dateTo=${date}&slotIntervalMin=15`,
      );
      const values = data.days.flatMap((day: any) => day.slots);
      setSlots(values);
      setVersion(data.dataVersion);
      setState(values.length ? "ready" : "empty");
      setStep(3);
    } catch (cause: any) {
      setError(cause.message);
      setState(cause.forbidden ? "forbidden" : "error");
    }
  }
  async function create() {
    if (!selected || !navigator.onLine) {
      setState("offline");
      return;
    }
    setState("loading");
    try {
      const items = draft.serviceIds.map((serviceId, index) => ({
        serviceId,
        staffPreference: { type: "ANY" },
        ...(index === 0
          ? { availabilityFingerprint: selected.fingerprint }
          : {}),
      }));
      const hold = await command("/v1/slot-holds", {
        branchId: draft.branchId,
        desiredStartAt: selected.startAt,
        availabilityDataVersion: version,
        source: "RECEPTION",
        clientKey: crypto.randomUUID(),
        items,
      });
      const appointment = await command("/v1/appointments", {
        holdId: hold.holdId,
        holdToken: hold.holdToken,
        customer: { customerId: draft.customerId, locale: "vi-VN" },
        confirm: true,
      });
      setResult(appointment);
      setState("ready");
      setStep(5);
    } catch (cause: any) {
      setError(
        cause.code === "BOOKING_VERSION_CONFLICT" ||
          cause.code === "AVAILABILITY_CHANGED"
          ? `${cause.code}: Reload availability and review again.`
          : cause.message,
      );
      setState(cause.forbidden ? "forbidden" : "error");
    }
  }
  return (
    <Shell title="Quick create">
      <ol className="tabs">
        <li>Customer</li>
        <li>Services</li>
        <li>Date/time</li>
        <li>Review</li>
        <li>Create</li>
      </ol>
      {step < 3 && (
        <form className="form-grid" onSubmit={find}>
          <label>
            Existing customer ID
            <input
              name="customerId"
              defaultValue={defaults.customerId}
              required
            />
          </label>
          <label>
            Service IDs in sequence
            <input
              name="serviceIds"
              defaultValue={defaults.serviceId}
              placeholder="UUID, UUID, UUID"
              required
            />
            <small>
              Up to five comma-separated services; each item receives a
              qualified technician and concrete resources.
            </small>
          </label>
          <label>
            Branch ID
            <input name="branchId" defaultValue={defaults.branchId} required />
          </label>
          <label>
            Date
            <input name="date" type="date" defaultValue="2026-08-10" required />
          </label>
          <button>Find availability</button>
        </form>
      )}
      <States state={state} error={error} retry={() => setStep(1)} />
      {step === 3 && state === "ready" && (
        <div className="slots">
          {slots.slice(0, 20).map((slot) => (
            <button
              key={slot.fingerprint}
              onClick={() => {
                setSelected(slot);
                setStep(4);
              }}
            >
              {new Date(slot.startAt).toLocaleTimeString("vi-VN")} ·{" "}
              {slot.priceReference.amount} {slot.priceReference.currency}
            </button>
          ))}
        </div>
      )}
      {step === 4 && selected && (
        <div className="state">
          <h2>Review appointment</h2>
          <p>
            {new Date(selected.startAt).toLocaleString("vi-VN")} ·{" "}
            {draft.serviceIds.length} sequential service item(s) · Any qualified
            technician per item
          </p>
          <ol>
            {draft.serviceIds.map((serviceId, index) => (
              <li key={`${serviceId}-${index}`}>
                {index + 1}. {serviceId}
              </li>
            ))}
          </ol>
          <p>Price and policy are snapshotted when the hold is consumed.</p>
          <button onClick={() => void create()}>Create and confirm</button>
        </div>
      )}
      {step === 5 && result && (
        <div className="success" role="status">
          <h2>Appointment created</h2>
          <p>
            {result.bookingReference} · {result.status}
          </p>
          <a href={`/admin/appointments/${result.id}/overview`}>
            Open appointment
          </a>
        </div>
      )}
    </Shell>
  );
}

function AppointmentDetail({
  appointmentId,
  tab,
}: {
  appointmentId: string;
  tab: string;
}) {
  const view = useLoad(`/v1/appointments/${appointmentId}`),
    [notice, setNotice] = useState(""),
    [commandError, setCommandError] = useState("");
  const row = view.data;
  async function run(action: string, payload: unknown) {
    setNotice("");
    setCommandError("");
    if (!navigator.onLine) {
      setCommandError("Internet connection required");
      return;
    }
    try {
      await command(`/v1/appointments/${appointmentId}/${action}`, payload);
      setNotice("Command completed successfully.");
      await view.load();
    } catch (cause: any) {
      setCommandError(
        cause.code === "BOOKING_VERSION_CONFLICT"
          ? "Version conflict. Reloaded the current appointment; review before retrying."
          : cause.message,
      );
      await view.load();
    }
  }
  if (view.state !== "ready")
    return (
      <Shell title="Appointment detail">
        <States state={view.state} error={view.error} retry={view.load} />
      </Shell>
    );
  return (
    <Shell title={row.bookingReference}>
      <nav className="tabs">
        {[
          "overview",
          "services",
          "customer",
          "policy",
          "history",
          "reschedule",
          "cancel",
        ].map((name) => (
          <a
            key={name}
            href={`/admin/appointments/${appointmentId}/${name}`}
            aria-current={tab === name}
          >
            {name}
          </a>
        ))}
      </nav>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {commandError && (
        <p className="error" role="alert">
          {commandError}
        </p>
      )}
      {tab === "overview" && (
        <div className="state">
          <h2>{row.status}</h2>
          <p>
            {new Date(row.startAt).toLocaleString("vi-VN")} –{" "}
            {new Date(row.endAt).toLocaleString("vi-VN")}
          </p>
          <p>
            Deposit: {row.depositStatus} · Version {row.version}
          </p>
          <div className="actions">
            {row.status === "PENDING_CONFIRMATION" && (
              <button
                onClick={() => void run("confirm", { version: row.version })}
              >
                Confirm
              </button>
            )}
            {row.status === "PENDING_DEPOSIT" && (
              <button
                onClick={() =>
                  void run("waive-deposit", {
                    version: row.version,
                    reason: "Approved by salon owner",
                  })
                }
              >
                Waive deposit
              </button>
            )}
            <a href={`/admin/appointments/${appointmentId}/reschedule`}>
              Reschedule
            </a>
            <a href={`/admin/appointments/${appointmentId}/cancel`}>Cancel</a>
          </div>
        </div>
      )}
      {tab === "services" && (
        <div className="slots">
          {row.items?.map((item: any) => (
            <article key={item.id}>
              <strong>
                {item.service?.name?.["vi-VN"] ?? item.service?.code}
              </strong>
              <span>{item.staff?.displayName}</span>
              <small>
                {item.serviceStartAt} → {item.serviceEndAt}
              </small>
            </article>
          ))}
        </div>
      )}
      {tab === "customer" && (
        <div className="state">
          <h2>{row.contact?.displayName}</h2>
          <p>{row.contact?.phone ?? row.contact?.email}</p>
          <p>{row.customerNote || "No customer note"}</p>
        </div>
      )}
      {tab === "policy" && (
        <pre className="data-panel">{JSON.stringify(row.policy, null, 2)}</pre>
      )}
      {tab === "history" && <History appointmentId={appointmentId} />}
      {tab === "cancel" && <CancelForm row={row} run={run} />}
      {tab === "reschedule" && <RescheduleForm row={row} run={run} />}
    </Shell>
  );
}
function History({ appointmentId }: { appointmentId: string }) {
  const view = useLoad(`/v1/appointments/${appointmentId}/history`);
  return (
    <>
      <States state={view.state} error={view.error} retry={view.load} />
      {view.state === "ready" && (
        <ol>
          {view.data.map((entry: any) => (
            <li key={entry.id}>
              <strong>
                {entry.from_status ?? "CREATED"} → {entry.to_status}
              </strong>{" "}
              · {entry.reason_code}
              <small>
                {new Date(entry.created_at).toLocaleString("vi-VN")}
              </small>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
function CancelForm({
  row,
  run,
}: {
  row: any;
  run: (action: string, payload: unknown) => Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run("cancel", {
      version: row.version,
      reasonCode: form.get("reasonCode"),
      note: form.get("note"),
      actorType: "USER",
    });
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <h2>Cancel without deleting</h2>
      <p>Policy outcome is calculated and retained with the audit history.</p>
      <label>
        Reason
        <select name="reasonCode">
          <option>CUSTOMER_REQUEST</option>
          <option>SALON_UNAVAILABLE</option>
          <option>DUPLICATE</option>
        </select>
      </label>
      <label>
        Note
        <input name="note" />
      </label>
      <button>Review and cancel</button>
    </form>
  );
}
function RescheduleForm({
  row,
  run,
}: {
  row: any;
  run: (action: string, payload: unknown) => Promise<void>;
}) {
  const [replacement, setReplacement] = useState<any>(),
    [error, setError] = useState("");
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const availability = await request(
          `/v1/availability?branchId=${row.branchId}&serviceId=${row.items[0].service.serviceId}&dateFrom=${form.get("date")}&dateTo=${form.get("date")}&slotIntervalMin=15`,
        ),
        slot = availability.days.flatMap((d: any) => d.slots)[0];
      if (!slot) throw new Error("No replacement slot is available");
      const hold = await command("/v1/slot-holds", {
        branchId: row.branchId,
        desiredStartAt: slot.startAt,
        availabilityDataVersion: availability.dataVersion,
        source: "RECEPTION",
        items: [
          {
            serviceId: row.items[0].service.serviceId,
            staffPreference: { type: "ANY" },
            availabilityFingerprint: slot.fingerprint,
          },
        ],
      });
      setReplacement(hold);
    } catch (cause: any) {
      setError(cause.message);
    }
  }
  return (
    <>
      <form className="form-grid" onSubmit={prepare}>
        <h2>Reschedule review</h2>
        <p>Current: {new Date(row.startAt).toLocaleString("vi-VN")}</p>
        <label>
          New date
          <input name="date" type="date" defaultValue="2026-08-10" />
        </label>
        <button>Hold replacement slot</button>
      </form>
      {error && <p className="error">{error}</p>}
      {replacement && (
        <div className="state">
          <p>
            New: {new Date(replacement.plan.startAt).toLocaleString("vi-VN")}
          </p>
          <p>
            The current schedule remains active until this command succeeds.
            Original price snapshot is retained.
          </p>
          <button
            onClick={() =>
              void run("reschedule", {
                version: row.version,
                replacementHoldId: replacement.holdId,
                replacementHoldToken: replacement.holdToken,
                reasonCode: "CUSTOMER_REQUEST",
              })
            }
          >
            Confirm reschedule
          </button>
        </div>
      )}
    </>
  );
}
