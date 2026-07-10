"use client";
import { FormEvent, useState } from "react";
import { login, selectWorkspace } from "../../lib/auth";
type Workspace = { membershipId: string; name: string; slug: string };
type State =
  "idle" | "loading" | "workspace" | "mfa" | "success" | "error" | "forbidden";
export default function LoginPage() {
  const [state, setState] = useState<State>("idle"),
    [message, setMessage] = useState(""),
    [workspaceToken, setWorkspaceToken] = useState(""),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    const form = new FormData(event.currentTarget);
    try {
      const data = await login({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (data.workspaceSelectionRequired) {
        setWorkspaceToken(data.workspaceToken);
        setWorkspaces(data.workspaces);
        setState("workspace");
        return;
      }
      if (data.authenticationState) {
        setState("mfa");
        setMessage(data.authenticationState === "MFA_ENROLLMENT_REQUIRED" ? "MFA enrollment is required." : "Enter your MFA code.");
        return;
      }
      setState("success");
      setMessage("Đăng nhập thành công.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Đã xảy ra lỗi");
    }
  }
  async function choose(id: string) {
    setState("loading");
    try {
      await selectWorkspace(workspaceToken, id);
      setState("success");
      setMessage("Đã chọn workspace.");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Không thể chọn workspace",
      );
    }
  }
  return (
    <main>
      <span className="eyebrow">NAILSOFT ADMIN</span>
      <h1>Đăng nhập</h1>
      {state !== "workspace" && (
        <form
          onSubmit={submit}
          aria-busy={state === "loading"}
          style={{ display: "grid", gap: 16, maxWidth: 420 }}
        >
          <label>
            Email
            <input
              name="email"
              type="email"
              required
            />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" required />
          </label>
          <button disabled={state === "loading"}>
            {state === "loading" ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      )}
      {state === "workspace" && (
        <section>
          <h2>Chọn workspace</h2>
          {workspaces.length === 0 ? (
            <p>Không có workspace đang hoạt động.</p>
          ) : (
            <ul>
              {workspaces.map((workspace) => (
                <li key={workspace.membershipId}>
                  <button onClick={() => void choose(workspace.membershipId)}>
                    {workspace.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {state === "mfa" && <section><h2>Additional verification</h2><p>{message}</p><a href="/auth/mfa">Continue to MFA</a></section>}
      {state === "error" && (
        <div role="alert">
          <p>{message}</p>
          <button onClick={() => setState("idle")}>Thử lại</button>
        </div>
      )}
      {state === "forbidden" && (
        <p role="alert">Bạn không có quyền truy cập ứng dụng quản trị.</p>
      )}
      {state === "success" && <p role="status">{message}</p>}
    </main>
  );
}
