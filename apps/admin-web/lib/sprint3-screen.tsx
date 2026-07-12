/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { FormEvent, useEffect, useState } from "react";
import { authorizedFetch } from "./auth";
type State = "loading" | "ready" | "empty" | "error" | "forbidden" | "offline";
const defaults = {
  branchId: "20000000-0000-4000-8000-000000000001",
  serviceId: "50000000-0000-4000-8000-000000000001",
  date: "2026-08-10",
};
export default function Sprint3Screen({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/admin/availability"))
    return <Availability pathname={pathname} />;
  if (pathname.startsWith("/admin/scheduling/blocks"))
    return <Blocks pathname={pathname} />;
  return <Calendar pathname={pathname} />;
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
        <a href="/admin/calendar/day">Calendar day</a>
        <a href="/admin/calendar/week">Calendar week</a>
        <a href="/admin/availability/search">Availability</a>
        <a href="/admin/availability/explain">Explain</a>
        <a href="/admin/scheduling/blocks">Busy blocks</a>
      </nav>
      <section className="card">
        <p className="eyebrow">SPRINT 3 · SCHEDULING READ</p>
        <div className="title-row">
          <div>
            <h1>{title}</h1>
            <p className="hint">
              Branch timezone is authoritative. Realtime invalidation triggers a
              refetch.
            </p>
          </div>
          <span className="timezone">Asia/Ho_Chi_Minh</span>
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
  state: State;
  error: string;
  retry: () => void;
}) {
  return (
    <>
      {state === "loading" && (
        <div className="skeleton" role="status">
          Loading scheduling data…
        </div>
      )}
      {state === "forbidden" && (
        <div className="state" role="alert">
          <h2>Permission denied</h2>
          <p>Your role cannot access this branch or staff calendar.</p>
        </div>
      )}
      {state === "offline" && (
        <div className="state" role="alert">
          <h2>Offline</h2>
          <p>Showing no authoritative changes. Reconnect before writing.</p>
          <button onClick={retry}>Reconnect</button>
        </div>
      )}
      {state === "error" && (
        <div className="state" role="alert">
          <h2>Unable to load</h2>
          <p>{error}</p>
          <button onClick={retry}>Retry</button>
        </div>
      )}
      {state === "empty" && (
        <div className="state">
          <h2>No results</h2>
          <p>No matching scheduling data is available.</p>
          <button onClick={retry}>Refresh</button>
        </div>
      )}
    </>
  );
}
async function read(
  path: string,
  setState: (x: State) => void,
  setData: (x: any) => void,
  setError: (x: string) => void,
) {
  setState("loading");
  try {
    const r = await authorizedFetch(path);
    const b = await r.json();
    if (r.status === 401 || r.status === 403) {
      setState("forbidden");
      return;
    }
    if (!r.ok) throw new Error(b.error?.message ?? "Request failed");
    setData(b.data);
    const empty = Array.isArray(b.data)
      ? !b.data.length
      : Array.isArray(b.data?.events)
        ? !b.data.events.length
        : Array.isArray(b.data?.days)
          ? !b.data.days.some((x: any) => x.slots?.length)
          : !b.data;
    setState(empty ? "empty" : "ready");
  } catch (e) {
    if (!navigator.onLine) setState("offline");
    else setState("error");
    setError(e instanceof Error ? e.message : "Request failed");
  }
}
function Calendar({ pathname }: { pathname: string }) {
  const week = pathname.includes("week"),
    [state, setState] = useState<State>("loading"),
    [data, setData] = useState<any>({ events: [] }),
    [error, setError] = useState("");
  const load = () =>
    read(
      `/v1/calendar/events?branchId=${defaults.branchId}&from=2026-08-10T00:00:00%2B07:00&to=${week ? "2026-08-17" : "2026-08-11"}T00:00:00%2B07:00`,
      setState,
      setData,
      setError,
    );
  useEffect(() => {
    void load();
  }, [week]);
  return (
    <Shell title={week ? "Calendar week" : "Calendar day"}>
      <div className="toolbar">
        <label>
          Branch
          <input value="Quận 1" readOnly />
        </label>
        <label>
          Event type
          <select defaultValue="ALL">
            <option>ALL</option>
            <option>SHIFT</option>
            <option>LEAVE</option>
            <option>BUSY_BLOCK</option>
          </select>
        </label>
        <button onClick={load}>Refetch</button>
      </div>
      <States state={state} error={error} retry={load} />
      {state === "ready" && (
        <div className={week ? "week-grid" : "calendar-grid"}>
          {data.events.map((e: any) => (
            <article
              className={`event ${e.eventType.toLowerCase()}`}
              key={e.id}
            >
              <strong>{e.title}</strong>
              <span>{e.eventType}</span>
              <time>{new Date(e.startAt).toLocaleString("vi-VN")}</time>
              <small>
                {e.localStart} → {e.localEnd}
              </small>
            </article>
          ))}
        </div>
      )}
      <p className="hint">
        Timezone: {data.timezone ?? "Asia/Ho_Chi_Minh"} · Reconnecting realtime
        clients must refetch this view.
      </p>
    </Shell>
  );
}
function Availability({ pathname }: { pathname: string }) {
  const explain = pathname.endsWith("/explain"),
    [state, setState] = useState<State>("empty"),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (explain)
      await read("/v1/availability/explain", setState, setData, setError);
    else
      await read(
        `/v1/availability?branchId=${f.get("branchId")}&serviceId=${f.get("serviceId")}&dateFrom=${f.get("dateFrom")}&dateTo=${f.get("dateTo")}&slotIntervalMin=${f.get("interval")}`,
        setState,
        setData,
        setError,
      );
  }
  async function explainSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("loading");
    try {
      const r = await authorizedFetch("/v1/availability/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId: f.get("branchId"),
          serviceId: f.get("serviceId"),
          startAt: f.get("startAt"),
        }),
      });
      const b = await r.json();
      if (r.status === 403) {
        setState("forbidden");
        return;
      }
      if (!r.ok) throw new Error(b.error?.message);
      setData(b.data);
      setState("ready");
    } catch (x) {
      setError(x instanceof Error ? x.message : "Explain failed");
      setState("error");
    }
  }
  return (
    <Shell title={explain ? "Availability explain" : "Availability search"}>
      <form className="form-grid" onSubmit={explain ? explainSubmit : submit}>
        <label>
          Branch ID
          <input name="branchId" defaultValue={defaults.branchId} required />
        </label>
        <label>
          Service ID
          <input name="serviceId" defaultValue={defaults.serviceId} required />
        </label>
        {explain ? (
          <label>
            Start with timezone
            <input
              name="startAt"
              defaultValue="2026-08-10T12:00:00+07:00"
              required
            />
          </label>
        ) : (
          <>
            <label>
              From
              <input
                name="dateFrom"
                type="date"
                defaultValue={defaults.date}
                required
              />
            </label>
            <label>
              To
              <input
                name="dateTo"
                type="date"
                defaultValue={defaults.date}
                required
              />
            </label>
            <label>
              Staff preference
              <select name="staff">
                <option>Any Technician</option>
              </select>
            </label>
            <label>
              Interval
              <select name="interval" defaultValue="15">
                <option>5</option>
                <option>10</option>
                <option>15</option>
                <option>30</option>
              </select>
            </label>
          </>
        )}
        <button>Calculate</button>
      </form>
      <States state={state} error={error} retry={() => setState("empty")} />
      {state === "ready" && !explain && (
        <>
          {data.days.map((d: any) => (
            <section className="day" key={d.localDate}>
              <h2>{d.localDate}</h2>
              {d.slots.length ? (
                <div className="slots">
                  {d.slots.map((s: any) => (
                    <article key={s.fingerprint}>
                      <strong>
                        {new Date(s.startAt).toLocaleTimeString("vi-VN")}–
                        {new Date(s.endAt).toLocaleTimeString("vi-VN")}
                      </strong>
                      <span>
                        {s.staffCandidates
                          .map((x: any) => x.displayName)
                          .join(", ")}
                      </span>
                      <small>
                        {s.priceReference?.amount} {s.priceReference?.currency}{" "}
                        · {s.fingerprint.slice(0, 12)}
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <ul>
                  {d.unavailableReasons?.map((r: any) => (
                    <li key={r.code}>
                      {r.code} ({r.count})
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="hint">
            Cache {data.cache?.hit ? "hit" : "miss"} · valid until{" "}
            {data.validUntil} · version {data.dataVersion}
          </p>
        </>
      )}
      {state === "ready" && explain && (
        <div className="rules">
          <h2>{data.available ? "Available" : "Unavailable"}</h2>
          {Object.entries(data.rules ?? {}).map(([rule, pass]) => (
            <p key={rule} className={pass ? "success" : "error"}>
              {pass ? "PASS" : "FAIL"} · {rule}
            </p>
          ))}
          {data.reasons?.map((r: any) => (
            <p key={r.code}>{r.code}</p>
          ))}
        </div>
      )}
    </Shell>
  );
}
function Blocks({ pathname }: { pathname: string }) {
  const [state, setState] = useState<State>("loading"),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = () =>
    read(
      `/v1/availability-blocks?branchId=${defaults.branchId}&from=2026-08-01T00:00:00%2B07:00&to=2026-09-01T00:00:00%2B07:00`,
      setState,
      setRows,
      setError,
    );
  useEffect(() => {
    void load();
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = {
        branchId: defaults.branchId,
        staffId: f.get("staffId"),
        blockType: "MANUAL",
        title: f.get("title"),
        startAt: f.get("startAt"),
        endAt: f.get("endAt"),
      };
    const r = await authorizedFetch("/v1/availability-blocks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) {
      setError(
        b.error?.code === "BUSY_BLOCK_VERSION_CONFLICT"
          ? "Version conflict. Reload before retrying."
          : b.error?.message,
      );
      setState(r.status === 403 ? "forbidden" : "error");
      return;
    }
    setNotice("Busy block created; availability invalidated.");
    await load();
  }
  async function cancel(row: any) {
    const r = await authorizedFetch(
      `/v1/availability-blocks/${row.id}/cancel`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ version: row.version }),
      },
    );
    if (!r.ok) {
      const b = await r.json();
      setError(b.error?.code ?? "Cancel failed");
      setState(r.status === 409 ? "error" : "forbidden");
      return;
    }
    setNotice("Busy block cancelled.");
    await load();
  }
  return (
    <Shell
      title={pathname.endsWith("/new") ? "Create manual block" : "Busy blocks"}
    >
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <form className="form-grid" onSubmit={create}>
        <label>
          Staff ID
          <input
            name="staffId"
            defaultValue="47000000-0000-4000-8000-000000000003"
            required
          />
        </label>
        <label>
          Title
          <input name="title" defaultValue="Training" required />
        </label>
        <label>
          Start (ISO + offset)
          <input
            name="startAt"
            defaultValue="2026-08-10T12:00:00+07:00"
            required
          />
        </label>
        <label>
          End (ISO + offset)
          <input
            name="endAt"
            defaultValue="2026-08-10T13:00:00+07:00"
            required
          />
        </label>
        <button>Create manual block</button>
      </form>
      <States state={state} error={error} retry={load} />
      {state === "ready" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Block</th>
                <th>Target</th>
                <th>Window</th>
                <th>Version</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.title}</strong>
                    <small>{row.blockType}</small>
                  </td>
                  <td>{row.staffId ?? row.resourceId}</td>
                  <td>
                    {row.startAt}
                    <br />
                    {row.endAt}
                  </td>
                  <td>{row.version}</td>
                  <td>
                    <button onClick={() => void cancel(row)}>Cancel</button>
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
