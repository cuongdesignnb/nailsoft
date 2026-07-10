"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";

const routeConfig: Record<string, { title: string; endpoint?: string; empty: string }> = {
  "/admin/dashboard": { title: "Salon overview", endpoint: "/v1/organization", empty: "No organization data is available." },
  "/admin/organization/general": { title: "Organization", endpoint: "/v1/organization", empty: "Organization settings are empty." },
  "/admin/organization/branches": { title: "Branches", endpoint: "/v1/branches", empty: "Create the first branch to get started." },
  "/admin/team/users": { title: "Team", endpoint: "/v1/users", empty: "No team members match the current filters." },
  "/admin/team/roles": { title: "Roles and permissions", empty: "No role definitions are available." },
  "/admin/security/sessions": { title: "My active sessions", endpoint: "/v1/auth/sessions", empty: "No active sessions." },
  "/admin/security/audit-logs": { title: "Audit logs", empty: "No audit events match the current filters." },
  "/admin/security/mfa": { title: "Multi-factor authentication", endpoint: "/v1/auth/mfa/status", empty: "MFA has not been enrolled." },
  "/admin/settings/localization": { title: "Language and locale", empty: "No locale preference has been selected." },
};

export default function Sprint1Screen() {
  const pathname = usePathname();
  const config = useMemo(() => routeConfig[pathname] ?? inferConfig(pathname), [pathname]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "forbidden">("loading");
  const [data, setData] = useState<unknown>();

  async function load() {
    if (!config.endpoint) { setState("empty"); return; }
    setState("loading");
    try {
      const response = await authorizedFetch(config.endpoint);
      if (response.status === 401 || response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("request failed");
      const body = await response.json();
      const value = body.data;
      setData(value);
      setState(Array.isArray(value) && value.length === 0 ? "empty" : "ready");
    } catch { setState("error"); }
  }
  useEffect(() => { void load(); }, [config.endpoint]);

  return (
    <main className="shell">
      <nav className="topbar"><a href="/admin/dashboard">Nailsoft</a><a href="/admin/organization/branches">Branches</a><a href="/admin/team/users">Team</a><a href="/admin/security/sessions">Security</a></nav>
      <section className="card" aria-busy={state === "loading"}>
        <p className="eyebrow">SPRINT 1 · IDENTITY & ORGANIZATION</p>
        <h1>{config.title}</h1>
        {state === "loading" && <div role="status" className="skeleton">Loading securely…</div>}
        {state === "forbidden" && <div role="alert"><h2>Permission required</h2><p>Your account cannot access this workspace area.</p></div>}
        {state === "error" && <div role="alert"><h2>Unable to load</h2><p>The request could not be completed.</p><button onClick={() => void load()}>Retry</button></div>}
        {state === "empty" && <div><h2>Nothing here yet</h2><p>{config.empty}</p><button onClick={() => void load()}>Refresh</button></div>}
        {state === "ready" && <pre className="data-panel">{JSON.stringify(data, null, 2)}</pre>}
        {(pathname.includes("/new") || pathname.endsWith("/invite")) && <OperationalForm kind={pathname.endsWith("/invite") ? "invitation" : "branch"} />}
      </section>
    </main>
  );
}

function OperationalForm({ kind }: { kind: "invitation" | "branch" }) {
  return <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
    <h2>{kind === "invitation" ? "Invite a team member" : "Create branch"}</h2>
    <label>Name<input required minLength={1} /></label>
    {kind === "invitation" && <label>Email or phone<input required /></label>}
    <label>Review<input value="Review required before submission" readOnly /></label>
    <button type="submit">Review</button>
    <p className="hint">Field validation, permission and server errors will appear before submission.</p>
  </form>;
}

function inferConfig(pathname: string) {
  if (pathname.includes("/branches/")) return { title: pathname.endsWith("/hours") ? "Business hours" : "Branch details", endpoint: "/v1/branches", empty: "Branch data is unavailable." };
  if (pathname.includes("/team/users/")) return { title: pathname.endsWith("/sessions") ? "User sessions" : "User details", endpoint: "/v1/users", empty: "User data is unavailable." };
  return { title: "Administration", empty: "No data is available." };
}
