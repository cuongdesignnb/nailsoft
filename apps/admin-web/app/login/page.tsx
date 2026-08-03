"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, selectWorkspace } from "../../lib/auth";

type Workspace = { membershipId: string; name: string; slug: string };
type State = "idle" | "loading" | "workspace" | "mfa" | "success" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [workspaceToken, setWorkspaceToken] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("loading");
    const form = new FormData(event.currentTarget);
    try {
      const data = await login({ email: String(form.get("email")), password: String(form.get("password")) });
      if (data.workspaceSelectionRequired) { setWorkspaceToken(data.workspaceToken); setWorkspaces(data.workspaces); setState("workspace"); return; }
      if (data.authenticationState) { setState("mfa"); setMessage(data.authenticationState === "MFA_ENROLLMENT_REQUIRED" ? "Activate MFA before continuing." : "Enter your MFA code to continue."); return; }
      setState("success"); setMessage("You are signed in."); router.replace("/admin/dashboard");
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Something went wrong."); }
  }
  async function choose(membershipId: string) {
    setState("loading");
    try { await selectWorkspace(workspaceToken, membershipId); setState("success"); setMessage("Workspace selected."); router.replace("/admin/dashboard"); }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Unable to select the workspace."); }
  }
  return <main className="ns-login"><section className="ns-login__panel"><p className="ns-eyebrow">NAILSOFT ADMIN</p><h1>Sign in</h1><p>Manage salon operations with tenant and branch-scoped access.</p>{state !== "workspace" ? <form onSubmit={submit} aria-busy={state === "loading"}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={state === "loading"}>{state === "loading" ? "Signing in..." : "Sign in"}</button></form> : <section className="ns-login__workspaces"><h2>Select workspace</h2>{workspaces.length === 0 ? <p>No active workspace is available.</p> : <ul>{workspaces.map((workspace) => <li key={workspace.membershipId}><button onClick={() => void choose(workspace.membershipId)}>{workspace.name}</button><small>{workspace.slug}</small></li>)}</ul>}</section>}{state === "mfa" ? <p role="status">{message} <a href="/auth/mfa">Continue verification</a></p> : null}{state === "error" ? <div role="alert"><p>{message}</p><button onClick={() => setState("idle")}>Try again</button></div> : null}{state === "success" ? <p role="status">{message}</p> : null}</section></main>;
}
