"use client";
import { useEffect, useState } from "react";
type Branch = { id: string; name: string; code: string; timezone: string };
type State = "loading" | "ready" | "empty" | "error" | "forbidden";
export default function SettingsPage() {
  const [state, setState] = useState<State>("loading");
  const [branches, setBranches] = useState<Branch[]>([]);
  async function load() {
    setState("loading");
    const token = sessionStorage.getItem("nailsoft.accessToken"),
      tenant = sessionStorage.getItem("nailsoft.tenantId");
    if (!token || !tenant) {
      setState("forbidden");
      return;
    }
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/branches`,
        {
          headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenant },
        },
      );
      if (response.status === 401 || response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error();
      const data = (await response.json()).data as Branch[];
      setBranches(data);
      setState(data.length ? "ready" : "empty");
    } catch {
      setState("error");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main>
      <span className="eyebrow">ORGANIZATION SETTINGS</span>
      <h1>Chi nhánh</h1>
      {state === "loading" && <p>Đang tải…</p>}
      {state === "empty" && <p>Chưa có chi nhánh.</p>}
      {state === "error" && (
        <div role="alert">
          <p>Không thể tải dữ liệu.</p>
          <button onClick={() => void load()}>Thử lại</button>
        </div>
      )}
      {state === "forbidden" && (
        <p role="alert">Phiên hết hạn hoặc bạn không có quyền xem chi nhánh.</p>
      )}
      {state === "ready" && (
        <ul>
          {branches.map((branch) => (
            <li key={branch.id}>
              <strong>{branch.name}</strong> · {branch.code} · {branch.timezone}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
