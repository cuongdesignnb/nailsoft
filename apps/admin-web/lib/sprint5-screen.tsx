/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { activeSession, authorizedFetch } from "./auth";
type State = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
async function api(path: string, init?: RequestInit) {
  const r = await authorizedFetch(path, init),
    b = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403)
    throw Object.assign(new Error("Permission denied"), { forbidden: true });
  if (!r.ok)
    throw Object.assign(new Error(b.error?.message ?? "Request failed"), {
      code: b.error?.code,
    });
  return b.data;
}
async function command(path: string, body: unknown) {
  if (!navigator.onLine) throw new Error("Internet connection required");
  return api(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
function useData(path: string | null, realtime = true) {
  const [state, setState] = useState<State>("loading"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    setState("loading");
    try {
      const x = await api(path);
      setData(x);
      setState(Array.isArray(x) && !x.length ? "empty" : "ready");
    } catch (e: any) {
      setError(e.message);
      setState(
        e.forbidden ? "forbidden" : !navigator.onLine ? "offline" : "error",
      );
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!realtime) return;
    const s = activeSession();
    if (!s.accessToken) return;
    const socket = io(`${s.api}/scheduling`, {
      auth: { token: s.accessToken },
      transports: ["websocket"],
    });
    [
      "operations.invalidated",
      "walkin.updated",
      "appointment.updated",
      "service_session.updated",
      "availability.invalidated",
    ].forEach((e) => socket.on(e, () => void load()));
    return () => {
      socket.disconnect();
    };
  }, [load, realtime]);
  return { state, data, error, load, setData };
}
function States({
  v,
  label,
}: {
  v: ReturnType<typeof useData>;
  label: string;
}) {
  if (v.state === "ready") return null;
  if (v.state === "loading")
    return (
      <div className="skeleton" role="status">
        Loading {label}…
      </div>
    );
  if (v.state === "forbidden")
    return (
      <div className="state" role="alert">
        <h2>Permission denied</h2>
        <p>Your role or branch scope does not allow this view.</p>
      </div>
    );
  if (v.state === "empty")
    return (
      <div className="state">
        <h2>No {label}</h2>
        <button onClick={() => void v.load()}>Refresh</button>
      </div>
    );
  return (
    <div className="state" role="alert">
      <h2>
        {v.state === "offline"
          ? "Internet connection required"
          : "Unable to load"}
      </h2>
      <p>{v.error}</p>
      <button onClick={() => void v.load()}>Retry</button>
    </div>
  );
}
function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="shell ops-shell">
      <nav className="topbar">
        <a href="/admin/operations/board">Operations</a>
        <a href="/admin/operations/walk-ins">Walk-ins</a>
        <a href="/admin/operations/walk-ins/new">New walk-in</a>
        <a href="/admin/appointments">Appointments</a>
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 5 · LIVE SALON OPERATIONS</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              PostgreSQL-authoritative commands, safe retry and realtime
              refetch.
            </p>
          </div>
          <span className="timezone">Live</span>
        </div>
        {children}
      </section>
    </main>
  );
}
function useBranch() {
  const list = useData("/v1/branches", false),
    [id, setId] = useState("");
  useEffect(() => {
    if (!id && list.data?.[0]?.id) setId(list.data[0].id);
  }, [id, list.data]);
  return { list, id, setId };
}
export default function Sprint5Screen({ pathname }: { pathname: string }) {
  if (
    pathname === "/admin/operations" ||
    pathname === "/admin/operations/board"
  )
    return <Board />;
  if (pathname === "/admin/operations/walk-ins/new") return <WalkInNew />;
  if (pathname === "/admin/operations/walk-ins") return <WalkIns />;
  if (pathname.startsWith("/admin/operations/walk-ins/"))
    return <WalkInDetail id={pathname.split("/").pop() ?? ""} />;
  const p = pathname.split("/").filter(Boolean);
  if (pathname.startsWith("/admin/service-sessions/"))
    return <Session id={p[2] ?? ""} />;
  return <Appointment id={p[2] ?? ""} action={p[3] ?? "execution"} />;
}
function BranchPicker({ b }: { b: ReturnType<typeof useBranch> }) {
  return (
    <label>
      Branch
      <select value={b.id} onChange={(e) => b.setId(e.target.value)}>
        <option value="">Select branch</option>
        {(b.list.data ?? []).map((x: any) => (
          <option key={x.id} value={x.id}>
            {x.code} · {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Board() {
  const b = useBranch(),
    v = useData(b.id ? `/v1/operations/board?branchId=${b.id}` : null),
    columns = [
      "UPCOMING",
      "ARRIVED",
      "WAITING",
      "IN_SERVICE",
      "PARTIALLY_COMPLETED",
      "READY_FOR_CHECKOUT",
    ];
  return (
    <Shell title="Operational board">
      <BranchPicker b={b} />
      <States v={v} label="operations" />
      {v.state === "ready" && (
        <>
          <p className="hint">
            Data version {v.data.dataVersion} ·{" "}
            {new Date(v.data.generatedAt).toLocaleTimeString()}
          </p>
          <div className="operations-board">
            {columns.map((c) => (
              <section className="board-column" key={c}>
                <h2>{c.replaceAll("_", " ")}</h2>
                {(v.data.columns[c] ?? []).length ? (
                  (v.data.columns[c] ?? []).map((x: any) => (
                    <article className="operation-card" key={x.id}>
                      <strong>{x.bookingReference}</strong>
                      <span>{x.customerDisplayName}</span>
                      <small>
                        {new Date(x.startAt).toLocaleTimeString()} · {x.status}
                      </small>
                      <a href={`/admin/appointments/${x.id}/execution`}>Open</a>
                    </article>
                  ))
                ) : (
                  <p className="hint">Empty</p>
                )}
              </section>
            ))}
          </div>
          <section>
            <h2>Walk-in queue</h2>
            <div className="queue-strip">
              {v.data.walkIns.length ? (
                v.data.walkIns.map((x: any) => (
                  <a key={x.id} href={`/admin/operations/walk-ins/${x.id}`}>
                    #{x.queueNumber} · {x.displayName} · {x.status} · ETA{" "}
                    {x.estimatedWaitMinutes ?? "—"}m
                  </a>
                ))
              ) : (
                <p>Queue is empty.</p>
              )}
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}
function WalkIns() {
  const b = useBranch(),
    v = useData(b.id ? `/v1/walk-ins?branchId=${b.id}` : null);
  return (
    <Shell title="Walk-in queue">
      <BranchPicker b={b} />
      <States v={v} label="walk-ins" />
      {v.state === "ready" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Customer</th>
                <th>Status</th>
                <th>ETA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {v.data.map((x: any) => (
                <tr key={x.id}>
                  <td>
                    #{x.queueNumber}
                    <small>Position {x.queuePosition}</small>
                  </td>
                  <td>{x.customerDisplayName}</td>
                  <td>
                    {x.status}
                    <small>{x.priority}</small>
                  </td>
                  <td>
                    {x.estimatedWaitMinutes ?? "—"} min
                    <small>Estimate, not guaranteed</small>
                  </td>
                  <td>
                    <a href={`/admin/operations/walk-ins/${x.id}`}>Open</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
function WalkInNew() {
  const b = useBranch(),
    services = useData("/v1/services?status=ACTIVE&pageSize=100", false),
    [msg, setMsg] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const x = await command("/v1/walk-ins", {
        branchId: b.id,
        displayName: f.get("displayName"),
        phone: f.get("phone") || undefined,
        items: [
          { serviceId: f.get("serviceId"), staffPreference: { type: "ANY" } },
        ],
      });
      location.href = `/admin/operations/walk-ins/${x.id}`;
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  return (
    <Shell title="Register walk-in">
      <States v={services} label="services" />
      {msg && <p className="error">{msg}</p>}
      <form className="form-grid" onSubmit={submit}>
        <BranchPicker b={b} />
        <label>
          Display name
          <input required name="displayName" />
        </label>
        <label>
          Phone (optional)
          <input name="phone" />
        </label>
        <label>
          Service
          <select required name="serviceId">
            <option value="">Select</option>
            {(services.data?.items ?? services.data ?? []).map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name?.["vi-VN"] ?? x.code} · {x.defaultDurationMin}m
              </option>
            ))}
          </select>
        </label>
        <button>Create queue entry</button>
        <p className="hint">ETA is an estimate and is not guaranteed.</p>
      </form>
    </Shell>
  );
}
function WalkInDetail({ id }: { id: string }) {
  const v = useData(`/v1/walk-ins/${id}`),
    [msg, setMsg] = useState(""),
    [pending, setPending] = useState(false);
  async function act(a: string, extra: any = {}) {
    if (pending) return;
    setPending(true);
    const old = v.data;
    v.setData({
      ...old,
      status: a === "ready" ? "READY" : a === "call" ? "CALLED" : old.status,
    });
    try {
      await command(`/v1/walk-ins/${id}/${a}`, {
        version: old.version,
        ...extra,
      });
      setMsg("Updated successfully.");
    } catch (e: any) {
      setMsg(
        e.code === "VERSION_CONFLICT"
          ? "Version conflict; current state was reloaded."
          : e.message,
      );
    } finally {
      await v.load();
      setPending(false);
    }
  }
  async function convert() {
    if (pending) return;
    setPending(true);
    try {
      const h = await command(`/v1/walk-ins/${id}/conversion-holds`, {}),
        x = await command(`/v1/walk-ins/${id}/convert`, {
          version: v.data.version,
          holdId: h.holdId,
        });
      setMsg(`Converted to appointment ${x.appointmentId}.`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      await v.load();
      setPending(false);
    }
  }
  return (
    <Shell title="Walk-in detail">
      <States v={v} label="walk-in" />
      {msg && (
        <p
          role="status"
          className={
            msg.includes("success") || msg.includes("Converted")
              ? "success"
              : "error"
          }
        >
          {msg}
        </p>
      )}
      {v.state === "ready" && (
        <div className="detail-grid">
          <section>
            <h2>Queue #{v.data.queueNumber}</h2>
            <p>
              {v.data.contact?.displayName} · {v.data.status}
            </p>
            <p>
              ETA {v.data.estimatedWaitMinutes ?? "—"} minutes{" "}
              <small>(not guaranteed)</small>
            </p>
            <ul>
              {v.data.items.map((x: any) => (
                <li key={x.id}>
                  {x.service?.name?.["vi-VN"] ?? x.service?.code}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Actions</h2>
            <div className="actions">
              {v.data.status === "WAITING" && (
                <button disabled={pending} onClick={() => void act("ready")}>
                  Ready
                </button>
              )}
              {v.data.status === "READY" && (
                <button disabled={pending} onClick={() => void act("call")}>
                  Call
                </button>
              )}
              {["READY", "CALLED"].includes(v.data.status) && (
                <button disabled={pending} onClick={() => void convert()}>
                  Convert through Booking Engine
                </button>
              )}
              {["WAITING", "READY"].includes(v.data.status) && (
                <button
                  disabled={pending}
                  onClick={() =>
                    void act("cancel", { reasonCode: "CUSTOMER_REQUEST" })
                  }
                >
                  Cancel
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
function Appointment({ id, action }: { id: string; action: string }) {
  const a = useData(`/v1/appointments/${id}`),
    sessions = useData(`/v1/service-sessions?appointmentId=${id}`),
    services = useData(
      action === "add-service"
        ? "/v1/services?status=ACTIVE&pageSize=100"
        : null,
      false,
    ),
    summary = useData(
      action === "checkout-summary"
        ? `/v1/appointments/${id}/checkout-summary`
        : null,
    ),
    [msg, setMsg] = useState(""),
    [addPlan, setAddPlan] = useState<any>();
  async function checkin() {
    try {
      await command(`/v1/appointments/${id}/arrive`, {
        arrivalMethod: "RECEPTION",
        partySize: 1,
      });
      await command(`/v1/appointments/${id}/check-in`, {
        version: a.data.version,
      });
      setMsg("Customer checked in.");
      await a.load();
      await sessions.load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function planService(serviceId: string) {
    try {
      const plan = await command(`/v1/appointments/${id}/add-service-plans`, {
        serviceId,
        staffPreference: { type: "ANY" },
      });
      setAddPlan({ ...plan, serviceId });
      setMsg("Schedule and current price revalidated. Review before approval.");
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function commitService() {
    try {
      const hold = await command(`/v1/appointments/${id}/add-service-holds`, {
        serviceId: addPlan.serviceId,
        staffPreference: { type: "ANY" },
      });
      await command(`/v1/appointments/${id}/add-service`, {
        holdId: hold.holdId,
        version: a.data.version,
        customerApprovalMethod: "VERBAL",
      });
      setMsg("Service approved and added without changing existing snapshots.");
      setAddPlan(undefined);
      await a.load();
      await sessions.load();
    } catch (e: any) {
      setMsg(
        e.code?.includes("VERSION")
          ? "Version conflict; reload and retry."
          : e.message,
      );
      await a.load();
    }
  }
  return (
    <Shell
      title={
        action === "check-in"
          ? "Appointment check-in"
          : action === "checkout-summary"
            ? "Checkout-ready summary"
            : action === "add-service"
              ? "Add service"
              : "Service execution"
      }
    >
      <States v={a} label="appointment" />
      {msg && <p className="success">{msg}</p>}
      {a.state === "ready" && (
        <section>
          <h2>{a.data.bookingReference}</h2>
          <p>
            {a.data.contact?.displayName} · {a.data.status}
          </p>
          {action === "check-in" && (
            <button onClick={() => void checkin()}>Arrive and check in</button>
          )}
        </section>
      )}
      {action === "execution" && (
        <>
          <States v={sessions} label="sessions" />
          {sessions.state === "ready" && (
            <div className="operations-board">
              {sessions.data
                .filter((x: any) => x.appointmentId === id)
                .map((x: any) => (
                  <article className="operation-card" key={x.id}>
                    <strong>
                      {x.service?.name?.["vi-VN"] ?? x.service?.code}
                    </strong>
                    <span>{x.status}</span>
                    <a href={`/admin/service-sessions/${x.id}`}>Open session</a>
                  </article>
                ))}
            </div>
          )}
        </>
      )}
      {action === "add-service" && (
        <section>
          <States v={services} label="services" />
          {services.state === "ready" && (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void planService(
                  String(new FormData(e.currentTarget).get("serviceId")),
                );
              }}
            >
              <label>
                Requested service
                <select name="serviceId" required defaultValue="">
                  <option value="">Select service</option>
                  {(services.data.items ?? services.data ?? []).map(
                    (x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.name?.["vi-VN"] ?? x.code} · {x.defaultDurationMin}m
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button>Preview availability and price</button>
            </form>
          )}
          {addPlan && (
            <div className="state">
              <h2>Approval review</h2>
              <p>
                {addPlan.startAt} → {addPlan.endAt}
              </p>
              <p>
                Schedule extends {addPlan.scheduleImpact.extendsMinutes}{" "}
                minutes.
              </p>
              <p className="hint">
                A new snapshot is created only after customer approval.
              </p>
              <button onClick={() => void commitService()}>
                Customer approved verbally · Add service
              </button>
            </div>
          )}
        </section>
      )}
      {action === "checkout-summary" && (
        <>
          <States v={summary} label="checkout summary" />
          {summary.state === "ready" && (
            <section>
              <h2>
                {summary.data.checkoutReady
                  ? "Ready for checkout"
                  : "Not ready"}
              </h2>
              <p>
                {summary.data.pricingPreview.subtotalMinor}{" "}
                {summary.data.pricingPreview.currency}
              </p>
              <p className="hint">
                Pricing preview only. No invoice or payment created.
              </p>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
function Session({ id }: { id: string }) {
  const v = useData(`/v1/service-sessions/${id}`),
    staff = useData("/v1/staff?status=ACTIVE", false),
    notes = useData(`/v1/service-sessions/${id}/notes`),
    media = useData(`/v1/service-sessions/${id}/media`),
    [msg, setMsg] = useState("");
  async function act(x: string, extra: any = {}) {
    const old = v.data;
    v.setData({
      ...old,
      status:
        x === "pause"
          ? "PAUSED"
          : x === "complete"
            ? "COMPLETED"
            : "IN_PROGRESS",
    });
    try {
      await command(`/v1/service-sessions/${id}/${x}`, {
        version: old.version,
        ...extra,
      });
      setMsg(`${x} completed.`);
      await v.load();
    } catch (e: any) {
      setMsg(
        e.code?.includes("VERSION")
          ? "Version conflict; state reloaded."
          : e.message,
      );
      await v.load();
    }
  }
  async function transfer(targetStaffId: string) {
    try {
      await command(`/v1/service-sessions/${id}/transfer-staff`, {
        version: v.data.version,
        targetStaffId,
        reasonCode: "SHIFT_CHANGE",
      });
      setMsg("Staff transferred atomically.");
      await v.load();
    } catch (e: any) {
      setMsg(
        e.code?.includes("VERSION")
          ? "Version conflict; state reloaded."
          : e.message,
      );
      await v.load();
    }
  }
  async function addNote(note: string) {
    try {
      await command(`/v1/service-sessions/${id}/notes`, {
        visibility: "TECHNICIAN",
        note,
      });
      setMsg("Note saved and sanitized by the server.");
      await notes.load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  async function checkMediaFoundation() {
    try {
      const result = await command(`/v1/service-sessions/${id}/media/presign`, {
        mediaType: "BEFORE",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        checksum: "0".repeat(64),
      });
      setMsg(
        result.enabled === false
          ? `Media disabled: ${result.reason}`
          : "Secure upload URL created.",
      );
      await media.load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  const sid = staff.data?.[0]?.id;
  return (
    <Shell title="Service session">
      <States v={v} label="service session" />
      {msg && (
        <p className={msg.includes("completed") ? "success" : "error"}>{msg}</p>
      )}
      {v.state === "ready" && (
        <div className="detail-grid">
          <section>
            <h2>{v.data.status}</h2>
            <p>
              Work {v.data.actualWorkSeconds}s · paused{" "}
              {v.data.totalPauseSeconds}s
            </p>
            <div className="actions">
              {v.data.status === "PENDING" && (
                <button
                  disabled={!sid}
                  onClick={() => void act("start", { staffId: sid })}
                >
                  Start
                </button>
              )}
              {v.data.status === "IN_PROGRESS" && (
                <button
                  onClick={() =>
                    void act("pause", { reasonCode: "CUSTOMER_BREAK" })
                  }
                >
                  Pause
                </button>
              )}
              {v.data.status === "PAUSED" && (
                <button onClick={() => void act("resume", { staffId: sid })}>
                  Resume
                </button>
              )}
              {["IN_PROGRESS", "PAUSED"].includes(v.data.status) && (
                <button onClick={() => void act("complete")}>Complete</button>
              )}
            </div>
            {["IN_PROGRESS", "PAUSED"].includes(v.data.status) && (
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  void transfer(
                    String(new FormData(e.currentTarget).get("targetStaffId")),
                  );
                }}
              >
                <label>
                  Transfer to
                  <select name="targetStaffId" required defaultValue="">
                    <option value="">Select qualified staff</option>
                    {(staff.data?.items ?? staff.data ?? [])
                      .filter((x: any) => x.id !== v.data.currentStaffId)
                      .map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.displayName ?? x.employeeCode}
                        </option>
                      ))}
                  </select>
                </label>
                <button>Transfer with reason</button>
              </form>
            )}
          </section>
          <section>
            <h2>Contribution history</h2>
            {v.data.segments.map((x: any) => (
              <p key={x.id}>
                Staff {x.staff_id}
                <small>
                  {x.started_at} → {x.ended_at ?? "active"}
                </small>
              </p>
            ))}
            <h2>Technician notes</h2>
            <States v={notes} label="notes" />
            {(notes.data ?? []).map((x: any) => (
              <p key={x.id}>{x.note}</p>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void addNote(String(new FormData(form).get("note")));
                form.reset();
              }}
            >
              <label>
                New note
                <textarea name="note" required maxLength={4000} />
              </label>
              <button>Save note</button>
            </form>
            <h2>Before / after media</h2>
            <States v={media} label="media" />
            <p>{(media.data ?? []).length} upload metadata records.</p>
            <button onClick={() => void checkMediaFoundation()}>
              Check secure upload availability
            </button>
          </section>
        </div>
      )}
    </Shell>
  );
}
