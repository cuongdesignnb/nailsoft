"use client";
import { FormEvent, useState } from "react";
type State = "idle" | "loading" | "success" | "error" | "forbidden";
export default function LoginPage() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/auth/login`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantSlug: form.get("tenant"),
            email: form.get("email"),
            password: form.get("password"),
            deviceId: "admin-web",
            deviceName: "Admin Web",
            platform: "web",
          }),
        },
      );
      const body = await response.json();
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error(body.error?.message ?? "Login failed");
      sessionStorage.setItem("nailsoft.accessToken", body.data.accessToken);
      sessionStorage.setItem("nailsoft.tenantId", body.data.tenantId);
      setState("success");
      setMessage("Đăng nhập thành công.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Đã xảy ra lỗi");
    }
  }
  return (
    <main>
      <span className="eyebrow">NAILSOFT ADMIN</span>
      <h1>Đăng nhập</h1>
      <form
        onSubmit={submit}
        aria-busy={state === "loading"}
        style={{ display: "grid", gap: 16, maxWidth: 420 }}
      >
        <label>
          Salon
          <input name="tenant" defaultValue="nailsoft-demo" required />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue="owner@example.test"
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
