"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, StatePanel } from "@nailsoft/ui-web";
import { getAuthContext } from "../auth";
import { commandApi, readApi, rowsFrom, Status, wave6Area, type AsyncState } from "./shared";
import type { Wave6Route } from "./routes";

type SupportGrant = Record<string, any>;

function dateLabel(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function rawState(grant: SupportGrant) {
  return String(grant.state ?? grant.status ?? "UNKNOWN").toUpperCase();
}

function shortId(value: unknown, label: string) {
  return value ? <span title={String(value)}>{label}</span> : "—";
}

function Boundary({ platform }: { platform: boolean }) {
  return <Card className="ns-support-access-boundary"><span className="ns-platform-catalog-mark" aria-hidden="true">◫</span><div><p className="eyebrow">{platform ? "PHẠM VI NỀN TẢNG" : "PHẠM VI SALON"}</p><h2>Không có quyền xem quyền hỗ trợ</h2><p>{platform ? "Phiên salon hiện tại không được mở dữ liệu quản trị Platform. Không suy đoán Tenant, nhân sự hoặc ticket từ URL." : "Quyền hỗ trợ chỉ hiển thị trong phạm vi salon và theo quyền được máy chủ cấp."}</p><div className="ns-support-access-actions"><a className="ns-button ns-button--secondary" href={platform ? "/admin/support-access" : "/admin/organization/general"}>{platform ? "Về quyền hỗ trợ salon" : "Về quản trị salon"}</a><a className="ns-button ns-button--secondary" href="/admin/support-access">Mở quyền hỗ trợ</a></div></div></Card>;
}

export default function SupportAccessWorkspace({ route }: { route: Wave6Route }) {
  if (route.href === "/platform/break-glass") return <main className="shell ops-shell ns-support-access-page"><PageHeader eyebrow="NailSoft · KIỂM SOÁT TRUY CẬP" title="Truy cập khẩn cấp" description="Kiểm soát khẩn cấp được hiển thị minh bạch theo chính sách bảo mật nền tảng." actions={<Button variant="secondary" onClick={() => window.location.reload()}>Làm mới</Button>} /><Card className="ns-support-access-disabled"><strong>Truy cập khẩn cấp đang được tắt</strong><p>Không thể cấp token, thông tin xác thực hoặc phiên khẩn cấp từ màn hình này.</p><span className="ns-support-access-disabled-state">BREAK_GLASS_DISABLED</span></Card></main>;

  const platform = route.href === "/platform/support-access" || route.href === "/platform/support-access-grants";
  const endpoint = platform ? "/v1/platform/support-access-grants" : "/v1/tenant/support-access-grants";
  const permission = platform ? "platform.support_grant.approve" : "tenant.support_grant.approve";
  const [state, setState] = useState<AsyncState>("loading");
  const [rows, setRows] = useState<SupportGrant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const intentKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState("loading"); setError("");
    const result = await Promise.allSettled([getAuthContext(), readApi(endpoint)]);
    const context = result[0];
    const grants = result[1];
    if (context.status === "fulfilled") setPermissions(context.value.supportAccess?.permissions ?? context.value.authorization?.permissions ?? []);
    if (grants.status === "rejected") {
      const cause: any = grants.reason;
      setError(cause?.message ?? "Không thể tải quyền hỗ trợ.");
      setState(cause?.forbidden ? "forbidden" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      return;
    }
    const next = rowsFrom(grants.value);
    setRows(next);
    setState(next.length ? "ready" : "empty");
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const requested = useMemo(() => rows.filter((row) => ["REQUESTED", "PENDING", "PENDING_APPROVAL"].includes(rawState(row))).length, [rows]);
  const active = useMemo(() => rows.filter((row) => ["APPROVED", "ACTIVE"].includes(rawState(row))).length, [rows]);
  const expired = useMemo(() => rows.filter((row) => row.expiresAt && new Date(String(row.expiresAt)).getTime() < Date.now() && !["REVOKED", "DENIED"].includes(rawState(row))).length, [rows]);

  async function act(action: "approve" | "deny" | "revoke", row: SupportGrant) {
    if (!row.id) return;
    const key = `${action}:${row.id}`;
    let intentKey = intentKeys.current.get(key);
    if (!intentKey) { intentKey = crypto.randomUUID(); intentKeys.current.set(key, intentKey); }
    setBusy(key); setError(""); setNotice("");
    try {
      const reason = action === "approve" ? undefined : action === "deny" ? "Đã rà soát trong màn hình quyền hỗ trợ" : "Thu hồi từ màn hình quyền hỗ trợ";
      await commandApi(`${endpoint}/${row.id}/${action}`, { version: row.version, ...(reason ? { reason } : {}) }, intentKey);
      setNotice("Máy chủ đã xác nhận thao tác. Dữ liệu đang được tải lại.");
      await load();
    } catch (cause: any) { setError(cause?.message ?? "Không thể hoàn tất thao tác."); }
    finally { setBusy(null); }
  }

  const canDecide = permissions.includes(permission);
  const title = platform ? "Quyền hỗ trợ nền tảng" : "Quyền hỗ trợ Tenant";
  const description = platform ? "Theo dõi grant hỗ trợ có phạm vi, thời hạn và kiểm soát kép; không mở rộng quyền salon." : "Theo dõi yêu cầu hỗ trợ của Tenant với người duyệt độc lập và thời hạn rõ ràng.";

  return <main className="shell ops-shell ns-support-access-page"><PageHeader eyebrow={`NailSoft · ${wave6Area(route.area)}`} title={title} description={description} actions={<Button variant="secondary" onClick={() => void load()} disabled={state === "loading"}>Làm mới</Button>} />
    {notice && <p className="success" role="status">{notice}</p>}
    {state === "loading" && <StatePanel state="loading" title="Đang tải quyền hỗ trợ" detail="Đang kiểm tra quyền và đọc grant từ máy chủ…" />}
    {state === "forbidden" && <Boundary platform={platform} />}
    {state === "offline" && <StatePanel state="offline" title="Đang ngoại tuyến" detail="Danh sách quyền hỗ trợ có thể chưa phải mới nhất." onRetry={() => void load()} />}
    {state === "error" && <StatePanel state="error" title="Không thể tải quyền hỗ trợ" detail={error} onRetry={() => void load()} />}
    {state === "empty" && <Card className="ns-support-access-empty"><span className="ns-platform-catalog-mark" aria-hidden="true">○</span><div><h2>Chưa có quyền hỗ trợ</h2><p>API không trả grant trong phạm vi được cấp quyền. Màn hình không tạo dữ liệu mẫu để lấp đầy danh sách.</p></div></Card>}
    {state === "ready" && <><section className="ns-support-access-kpis" aria-label="Tóm tắt quyền hỗ trợ"><article><span>Tổng grant</span><strong>{rows.length}</strong><small>Đọc từ API quyền hỗ trợ</small></article><article><span>Chờ xử lý</span><strong>{requested}</strong><small>Chưa có quyết định cuối</small></article><article><span>Đã duyệt / đang dùng</span><strong>{active}</strong><small>Trạng thái do máy chủ trả về</small></article><article><span>Cần rà soát hạn</span><strong>{expired}</strong><small>Được tính từ expiresAt thực tế</small></article></section><Card className="ns-support-access-table"><header><div><p className="eyebrow">GRANT ĐÃ LƯU</p><h2>{title}</h2><p>{rows.length} grant trong phạm vi hiện tại.</p></div><span className="ns-support-access-scope">{platform ? "Platform scope" : "Tenant scope"}</span></header><div className="ns-support-access-table-wrap"><table><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Tenant đích</th><th scope="col">Nhân sự hỗ trợ</th><th scope="col">Ticket</th><th scope="col">Trạng thái</th><th scope="col">Bắt đầu</th><th scope="col">Hết hạn</th><th scope="col">Thao tác</th></tr></thead><tbody>{rows.map((row, index) => { const id = String(row.id ?? index); const status = rawState(row); const canApprove = canDecide && ["REQUESTED", "PENDING", "PENDING_APPROVAL"].includes(status); const canRevoke = canDecide && ["APPROVED", "ACTIVE"].includes(status); return <tr key={id}><td>{shortId(row.tenantId ?? row.tenant_id, "Tenant được cấp quyền")}</td><td>{shortId(row.supportUserId ?? row.support_user_id, "Nhân sự được cấp quyền")}</td><td>{row.ticketReference ?? row.ticket_reference ?? "—"}</td><td><Status value={status} /></td><td>{dateLabel(row.startsAt ?? row.starts_at)}</td><td>{dateLabel(row.expiresAt ?? row.expires_at)}</td><td className="ns-support-access-row-actions">{canApprove && <Button variant="secondary" disabled={busy !== null} onClick={() => void act("approve", row)}>{busy === `approve:${id}` ? "Đang xử lý…" : "Phê duyệt"}</Button>}{canApprove && <Button variant="secondary" disabled={busy !== null} onClick={() => void act("deny", row)}>{busy === `deny:${id}` ? "Đang xử lý…" : "Từ chối"}</Button>}{canRevoke && <Button variant="secondary" disabled={busy !== null} onClick={() => void act("revoke", row)}>{busy === `revoke:${id}` ? "Đang xử lý…" : "Thu hồi"}</Button>}{!canApprove && !canRevoke && <span className="hint">Không có thao tác</span>}</td></tr>; })}</tbody></table></div></Card><Card className="ns-support-access-safety"><strong>Kiểm soát kép và phạm vi</strong><p>Người yêu cầu không thể tự phê duyệt. Quyền, branch scope, phân loại dữ liệu, thời hạn và phiên hỗ trợ được máy chủ kiểm tra; UI không cấp token hoặc tự kéo dài grant.</p></Card></>}
    {error && state === "ready" && <p className="error" role="alert">{error}</p>}
  </main>;
}
