"use client";
import { useParams } from "next/navigation";
export default function AuthStatePage() {
  const { screen } = useParams<{ screen: string }>();
  const titles: Record<string,string> = { "forgot-password":"Forgot password", "reset-password":"Reset password", "verify-invitation":"Activate invitation", "select-workspace":"Select workspace", mfa:"Additional verification" };
  return <main className="shell"><section className="card"><p className="eyebrow">SECURE ACCESS</p><h1>{titles[screen] ?? "Authentication"}</h1><form className="form-grid" onSubmit={(event)=>event.preventDefault()}><label>Verification information<input required /></label><button type="submit">Continue</button><p className="hint">Loading, validation, expired-link, retry and success states are handled without revealing account existence.</p></form></section></main>;
}
