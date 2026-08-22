"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { clearPendingMfa, confirmPendingMfa, enrollPendingMfa, getPendingMfa, login, verifyPendingMfa } from "../../../lib/auth";
export default function AuthStatePage() {
  const { screen } = useParams<{ screen: string }>();
  const router = useRouter();
  const [pending, setPending] = useState(getPendingMfa());
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "success">("idle");
  const [message, setMessage] = useState("");
  const titles: Record<string,string> = { "forgot-password":"Forgot password", "reset-password":"Reset password", "verify-invitation":"Activate invitation", "select-workspace":"Select workspace", mfa:"Additional verification" };
  useEffect(() => { if (screen === "mfa" && !getPendingMfa()) setMessage("Phiên xác minh đã hết hạn. Hãy đăng nhập lại."); }, [screen]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("loading"); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await login({ email: String(form.get("email")), password: String(form.get("password")) });
      if (result.workspaceSelectionRequired) throw new Error("Tài khoản có nhiều workspace; hãy bắt đầu từ màn hình đăng nhập chính.");
      if (!result.authenticationState) { router.replace("/admin/dashboard"); return; }
      setPending(getPendingMfa()); setState("idle"); setMessage(result.authenticationState === "MFA_ENROLLMENT_REQUIRED" ? "Thiết lập MFA để tiếp tục." : "Nhập mã MFA để tiếp tục.");
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Không thể đăng nhập."); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("loading"); setMessage("");
    try {
      const current = getPendingMfa();
      if (!current) throw new Error("Phiên xác minh đã hết hạn. Hãy đăng nhập lại.");
      if (current.authenticationState === "MFA_ENROLLMENT_REQUIRED" && !secret) {
        const enrollment = await enrollPendingMfa();
        setSecret(enrollment.secret);
        setState("ready");
        setMessage("Đã tạo khóa MFA tạm thời. Nhập mã 6 số từ ứng dụng xác thực để hoàn tất.");
        return;
      }
      if (!/^[0-9]{6}$/.test(code)) throw new Error("Nhập mã MFA gồm 6 chữ số.");
      if (current.authenticationState === "MFA_ENROLLMENT_REQUIRED") await confirmPendingMfa(code); else await verifyPendingMfa(code);
      setState("success"); setMessage("Xác minh thành công."); router.replace("/admin/dashboard");
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Không thể xác minh MFA."); }
  }
  if (screen !== "mfa") return <main className="shell"><section className="card"><p className="eyebrow">SECURE ACCESS</p><h1>{titles[screen] ?? "Authentication"}</h1><p>Trang xác thực này chưa có thao tác cho đường dẫn hiện tại.</p></section></main>;
  if (!pending && !secret) return <main className="shell"><section className="card"><p className="eyebrow">SECURE ACCESS</p><h1>Đăng nhập để xác minh</h1><p>Phiên MFA chưa được giữ lại trên thiết bị này. Đăng nhập lại để tiếp tục.</p><form className="form-grid" onSubmit={(event) => void signIn(event)} aria-busy={state === "loading"}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required /></label><button type="submit" disabled={state === "loading"}>{state === "loading" ? "Đang đăng nhập…" : "Đăng nhập"}</button></form>{message ? <p role={state === "error" ? "alert" : "status"}>{message}</p> : null}</section></main>;
  const enrollment = pending?.authenticationState === "MFA_ENROLLMENT_REQUIRED";
  return <main className="shell"><section className="card"><p className="eyebrow">SECURE ACCESS</p><h1>Additional verification</h1><p>{enrollment ? "Thiết lập MFA để bảo vệ workspace trước khi tiếp tục." : "Nhập mã xác minh từ ứng dụng xác thực."}</p>{secret ? <div className="ns-mfa-secret" role="status"><strong>Khóa thiết lập</strong><code>{secret}</code><small>Chỉ hiển thị trong phiên này. Không lưu vào URL, localStorage hoặc log.</small></div> : null}<form className="form-grid" onSubmit={(event) => void submit(event)} aria-busy={state === "loading"}><label>Mã MFA 6 chữ số<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required={Boolean(secret || !enrollment)} /></label><button type="submit" disabled={state === "loading"}>{state === "loading" ? "Đang xác minh…" : enrollment && !secret ? "Bắt đầu thiết lập" : "Xác minh"}</button></form>{message ? <p role={state === "error" ? "alert" : "status"}>{message}</p> : null}{state === "success" ? <button type="button" className="ns-mfa-primary" onClick={() => router.replace("/admin/appointments/new")}>Mở trang tạo lịch hẹn</button> : null}<a className="ns-mfa-secondary" href="/auth/login" onClick={() => clearPendingMfa()}>Đăng nhập lại</a></section></main>;
}
