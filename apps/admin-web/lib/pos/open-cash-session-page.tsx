"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthContext } from "@nailsoft/domain-types";
import {
  ACTIVE_BRANCH_CHANGED_EVENT,
  authorizedFetch,
  getAuthorizedBranchContext,
  setActiveBranchId,
} from "../auth";
import styles from "./open-cash-session-page.module.css";

type Drawer = {
  id: string;
  code: string;
  name: string;
  currency: string;
  status: string;
};

type Register = {
  id: string;
  branchId: string;
  code: string;
  name: string;
  status: string;
  deviceBindingRequired: boolean;
  version: number;
  drawers: Drawer[];
};

type Session = {
  id: string;
  registerId: string;
  cashDrawerId: string;
  status: string;
  cashierUserId: string;
};

type ApiBody = {
  data?: unknown;
  error?: { code?: string; message?: string };
};

type ApiError = Error & { code?: string; status?: number };

type DeviceState = "idle" | "loading" | "ready" | "blocked";

const ZERO_DECIMAL_CURRENCIES = new Set(["VND", "JPY", "KRW"]);

function unwrap<T>(body: ApiBody): T {
  return body.data as T;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await authorizedFetch(path);
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) {
    const error = Object.assign(
      new Error(body.error?.message ?? "Không thể tải dữ liệu."),
      { code: body.error?.code, status: response.status },
    ) as ApiError;
    throw error;
  }
  return unwrap<T>(body);
}

async function postOpen(
  body: { registerId: string; cashDrawerId: string; openingFloatMinor: number },
  key: string,
) {
  const response = await authorizedFetch("/v1/cash-sessions/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as ApiBody;
  if (!response.ok) {
    throw Object.assign(
      new Error(result.error?.message ?? "Không thể mở phiên thu ngân."),
      { code: result.error?.code, status: response.status },
    ) as ApiError;
  }
  return unwrap<{ id: string }>(result);
}

function activeDrawers(register?: Register) {
  return register?.drawers.filter((drawer) => drawer.status === "ACTIVE") ?? [];
}

function activeSessionFor(registerId: string, sessions: Session[]) {
  return sessions.find(
    (session) =>
      session.registerId === registerId &&
      (session.status === "OPEN" || session.status === "CLOSING"),
  );
}

function registerState(register: Register, sessions: Session[]) {
  if (register.status !== "ACTIVE") return "NOT_AVAILABLE" as const;
  const session = activeSessionFor(register.id, sessions);
  if (session?.status === "CLOSING") return "CLOSING" as const;
  if (session?.status === "OPEN") return "OPEN" as const;
  return "READY" as const;
}

function parseInteger(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function minorUnit(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

function formatMoney(valueMinor: number, currency: string) {
  const unit = minorUnit(currency);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    minimumFractionDigits: unit,
    maximumFractionDigits: unit,
  }).format(valueMinor / 10 ** unit);
}

function currencyPresets(currency: string) {
  const unit = minorUnit(currency);
  if (unit === 0) return [500_000, 1_000_000, 1_500_000, 2_000_000];
  return [100, 500, 1_000, 5_000].map((value) => value * 10 ** unit);
}

function denominations(currency: string) {
  const unit = minorUnit(currency);
  if (unit === 0) return [500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000];
  return [100, 50, 20, 10, 5, 1].map((value) => value * 10 ** unit);
}

function displayDate() {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function errorMessage(reason: unknown) {
  const code = reason && typeof reason === "object" && "code" in reason
    ? String((reason as { code?: string }).code ?? "")
    : "";
  const messages: Record<string, string> = {
    CASH_SESSION_ALREADY_OPEN: "Quầy hoặc ngăn kéo đã có phiên đang mở. Dữ liệu đã được tải lại.",
    CASH_REGISTER_NOT_FOUND: "Quầy không còn hoạt động hoặc không thuộc chi nhánh hiện tại.",
    CASH_DRAWER_NOT_FOUND: "Ngăn kéo tiền mặt không còn hoạt động. Hãy chọn ngăn kéo khác.",
    CASH_SESSION_CURRENCY_MISMATCH: "Đơn vị tiền của ngăn kéo không khớp với chi nhánh.",
    POS_REGISTER_DEVICE_SESSION_INVALID: "Phiên thiết bị không còn hợp lệ. Hãy đăng nhập lại để tiếp tục.",
    POS_REGISTER_DEVICE_NOT_BOUND: "Thiết bị hiện tại chưa được liên kết với quầy này.",
    FINANCIAL_BRANCH_INACTIVE: "Chi nhánh hiện không hoạt động nên chưa thể mở phiên.",
  };
  if (messages[code]) return messages[code];
  if (reason instanceof Error && reason.message) return reason.message;
  return "Không thể hoàn tất thao tác. Hãy thử lại.";
}

function statusLabel(state: ReturnType<typeof registerState>) {
  return {
    OPEN: "Đang hoạt động",
    CLOSING: "Đang đóng ca",
    READY: "Sẵn sàng",
    NOT_AVAILABLE: "Không khả dụng",
  }[state];
}

function stateClass(state: ReturnType<typeof registerState>) {
  return {
    OPEN: styles.stateOpen,
    CLOSING: styles.stateClosing,
    READY: styles.stateReady,
    NOT_AVAILABLE: styles.stateUnavailable,
  }[state];
}

function CheckIcon({ state }: { state: "ok" | "warn" | "muted" }) {
  return <span className={`${styles.checkIcon} ${styles[`check${state.charAt(0).toUpperCase()}${state.slice(1)}`]}`} aria-hidden="true">{state === "ok" ? "✓" : state === "warn" ? "!" : "·"}</span>;
}

function RegisterCard({
  register,
  sessions,
  selected,
  onSelect,
}: {
  register: Register;
  sessions: Session[];
  selected: boolean;
  onSelect: () => void;
}) {
  const state = registerState(register, sessions);
  const drawers = activeDrawers(register);
  const selectable = state === "READY" && drawers.length > 0;
  const current = activeSessionFor(register.id, sessions);
  return (
    <button
      className={`${styles.registerCard} ${selected ? styles.registerCardSelected : ""} ${!selectable ? styles.registerCardDisabled : ""}`}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!selectable}
      onClick={onSelect}
    >
      <span className={styles.registerCardHead}>
        <span className={styles.registerGlyph} aria-hidden="true">▣</span>
        <span className={`${styles.statusBadge} ${stateClass(state)}`}><i />{statusLabel(state)}</span>
      </span>
      <strong className={styles.registerName}>{register.name}</strong>
      <span className={styles.registerCode}>{register.code}</span>
      <span className={styles.registerFacts}>
        <span><b>Chi nhánh</b>{register.branchId ? "Đang chọn" : "Chưa xác định"}</span>
        <span><b>Ngăn kéo</b>{drawers.length} đang hoạt động</span>
      </span>
      {state === "READY" ? (
        <span className={styles.registerAvailability}>
          <CheckIcon state={drawers.length > 0 ? "ok" : "warn"} />
          {drawers.length > 0 ? "Có thể chọn quầy này" : "Chưa có ngăn kéo hoạt động"}
        </span>
      ) : (
        <span className={styles.registerAvailability}>
          <CheckIcon state="muted" />
          {current ? `Phiên hiện tại: ${current.status === "OPEN" ? "đang mở" : "đang đóng ca"}` : "Không thể mở phiên"}
        </span>
      )}
      <span className={styles.registerSelectMark} aria-hidden="true">{selected ? "✓" : ""}</span>
    </button>
  );
}

function ReadinessRow({ label, detail, state }: { label: string; detail: string; state: "ok" | "warn" | "muted" }) {
  return <li><CheckIcon state={state} /><span><strong>{label}</strong><small>{detail}</small></span></li>;
}

export default function OpenCashSessionPage() {
  const [authContext, setAuthContext] = useState<AuthContext>();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState("");
  const [registers, setRegisters] = useState<Register[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [drawerId, setDrawerId] = useState("");
  const [openingDraft, setOpeningDraft] = useState("0");
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [deviceError, setDeviceError] = useState("");
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [registerConfirmed, setRegisterConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingDataError, setLoadingDataError] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [prefillWarning, setPrefillWarning] = useState("");
  const [online, setOnline] = useState(true);
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});

  const load = useCallback(async (nextBranchId: string, silent = false) => {
    if (!nextBranchId) {
      setLoading(false);
      setRegisters([]);
      setSessions([]);
      return;
    }
    if (!silent) setLoading(true);
    setLoadingDataError("");
    try {
      const [nextRegisters, nextSessions] = await Promise.all([
        getJson<Register[]>(`/v1/pos-registers?branchId=${encodeURIComponent(nextBranchId)}`),
        getJson<Session[]>(`/v1/cash-sessions?branchId=${encodeURIComponent(nextBranchId)}`),
      ]);
      setRegisters(nextRegisters ?? []);
      setSessions(nextSessions ?? []);
      setSelectedId((current) => {
        if (current && (nextRegisters ?? []).some((register) => register.id === current)) return current;
        return "";
      });
    } catch (reason) {
      setLoadingDataError(errorMessage(reason));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);

  useEffect(() => {
    void getAuthorizedBranchContext()
      .then(({ context, branches: nextBranches, branchId: nextBranchId }) => {
        setAuthContext(context);
        setBranches(nextBranches);
        setBranchId(nextBranchId ?? "");
      })
      .catch((reason) => setLoadingDataError(errorMessage(reason)));
    const branchHandler = (event: Event) => {
      const next = (event as CustomEvent<string | undefined>).detail ?? "";
      setBranchId(next);
      setSelectedId("");
      setDrawerId("");
      setPrefillWarning("");
    };
    window.addEventListener(ACTIVE_BRANCH_CHANGED_EVENT, branchHandler);
    return () => window.removeEventListener(ACTIVE_BRANCH_CHANGED_EVENT, branchHandler);
  }, []);

  useEffect(() => {
    void load(branchId);
    const timer = window.setInterval(() => void load(branchId, true), 15_000);
    return () => window.clearInterval(timer);
  }, [branchId, load]);

  useEffect(() => {
    if (typeof window === "undefined" || registers.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get("registerId");
    if (requested) {
      const candidate = registers.find((register) => register.id === requested);
      if (candidate && registerState(candidate, sessions) === "READY" && activeDrawers(candidate).length > 0) {
        setSelectedId(candidate.id);
        setPrefillWarning("");
      } else if (candidate || requested) {
        setPrefillWarning("Quầy được chọn từ đường dẫn vừa thay đổi trạng thái. Vui lòng chọn quầy khác.");
      }
      return;
    }
    setSelectedId((current) => current || registers.find((register) => registerState(register, sessions) === "READY" && activeDrawers(register).length > 0)?.id || "");
  }, [registers, sessions]);

  const selectedRegister = registers.find((register) => register.id === selectedId);
  const selectedDrawers = useMemo(() => activeDrawers(selectedRegister), [selectedRegister]);
  const selectedDrawer = selectedDrawers.find((drawer) => drawer.id === drawerId);
  const currency = selectedDrawer?.currency ?? selectedDrawers[0]?.currency ?? "VND";
  const openingMinor = parseInteger(openingDraft);
  const selectedState = selectedRegister ? registerState(selectedRegister, sessions) : "NOT_AVAILABLE" as const;
  const hasPermission = Boolean(authContext?.authorization.permissions.includes("cash_session.open"));
  const readyRegister = Boolean(selectedRegister && selectedState === "READY");
  const readyDrawer = Boolean(selectedDrawer && selectedDrawer.status === "ACTIVE");
  const amountValid = openingMinor >= 0 && Number.isSafeInteger(openingMinor);
  const canSubmit = Boolean(
    !loading &&
    !loadingDataError &&
    online &&
    hasPermission &&
    readyRegister &&
    readyDrawer &&
    amountValid &&
    deviceState === "ready" &&
    cashConfirmed &&
    registerConfirmed &&
    !submitting,
  );
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "Chi nhánh hiện tại";

  useEffect(() => {
    if (!selectedRegister) {
      setDrawerId("");
      setDeviceState("idle");
      return;
    }
    const drawers = activeDrawers(selectedRegister);
    setDrawerId((current) => drawers.some((drawer) => drawer.id === current) ? current : drawers.length === 1 ? drawers[0]!.id : "");
    setDeviceState("loading");
    setDeviceError("");
    let cancelled = false;
    getJson<{ status: string }>(`/v1/pos-registers/${selectedRegister.id}/access-status`)
      .then(() => { if (!cancelled) setDeviceState("ready"); })
      .catch((reason) => { if (!cancelled) { setDeviceState("blocked"); setDeviceError(errorMessage(reason)); } });
    return () => { cancelled = true; };
  }, [selectedRegister]);

  useEffect(() => {
    setIdempotencyKey(undefined);
  }, [selectedId, drawerId, openingMinor]);

  const setSelection = (nextId: string) => {
    setActionError("");
    setSelectedId(nextId);
    setDrawerId("");
    setCashConfirmed(false);
    setRegisterConfirmed(false);
  };

  const selectBranch = (nextBranchId: string) => {
    setBranchId(nextBranchId);
    setActiveBranchId(nextBranchId || undefined);
    setSelectedId("");
    setDrawerId("");
    setCashConfirmed(false);
    setRegisterConfirmed(false);
  };

  const submit = async () => {
    if (!canSubmit || !selectedRegister || !selectedDrawer) return;
    setSubmitting(true);
    setActionError("");
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    try {
      const result = await postOpen({ registerId: selectedRegister.id, cashDrawerId: selectedDrawer.id, openingFloatMinor: openingMinor }, key);
      if (!result?.id) throw new Error("API không trả về mã phiên thu ngân.");
      window.location.href = `/admin/pos/cash-sessions/${result.id}`;
    } catch (reason) {
      setActionError(errorMessage(reason));
      const code = reason && typeof reason === "object" && "code" in reason ? String((reason as ApiError).code ?? "") : "";
      if (code === "POS_REGISTER_DEVICE_NOT_BOUND" || code === "POS_REGISTER_DEVICE_SESSION_INVALID") {
        setDeviceState("blocked");
        setDeviceError(errorMessage(reason));
      }
      if (["CASH_SESSION_ALREADY_OPEN", "CASH_REGISTER_NOT_FOUND", "CASH_DRAWER_NOT_FOUND", "CASH_SESSION_CURRENCY_MISMATCH"].includes(code)) {
        await load(branchId, true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const quickAmounts = currencyPresets(currency);
  const denomTotals = denominations(currency).map((value) => value * (denominationCounts[value] ?? 0));
  const denominationTotal = denomTotals.reduce((sum, value) => sum + value, 0);
  const setAmount = (value: number) => {
    setOpeningDraft(String(value));
    setActionError("");
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.breadcrumb}><span>POS</span><b>/</b><span>Quầy thu ngân</span><b>/</b> Mở phiên</p>
          <h1>Mở phiên thu ngân</h1>
          <p className={styles.subtitle}>Xác nhận quầy, nhân viên phụ trách và số tiền mặt đầu ca trước khi bắt đầu nhận thanh toán.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => { window.location.href = "/admin/pos/registers"; }}>← &nbsp;Quay lại quản lý quầy</button>
          <button className={styles.primaryButton} type="button" disabled={!canSubmit} onClick={() => void submit()}>▣ &nbsp;Mở phiên thu ngân</button>
        </div>
      </header>

      <div className={styles.notice} role="status">
        <span className={styles.noticeIcon} aria-hidden="true">♢</span>
        <span><strong>Mỗi quầy chỉ có thể có một phiên thu ngân đang mở tại một thời điểm.</strong><small>Mọi giao dịch tiền mặt trong ca sẽ được ghi nhận vào phiên này để phục vụ đối soát cuối ca.</small></span>
      </div>

      {branches.length > 1 && <section className={styles.branchBar} aria-label="Chọn chi nhánh">
        <label><span>Chi nhánh đang thao tác</span><select value={branchId} onChange={(event) => selectBranch(event.target.value)}><option value="">Chọn chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <span className={styles.branchDate}>{branchName} · {displayDate()}</span>
      </section>}

      {loading && <div className={styles.loadingCard} role="status">Đang tải quầy và phiên thu ngân…</div>}
      {loadingDataError && <div className={styles.errorCard} role="alert"><strong>Không thể tải dữ liệu mở phiên.</strong><span>{loadingDataError}</span><button type="button" onClick={() => void load(branchId)}>Thử lại</button></div>}

      {!loading && !loadingDataError && <div className={styles.workspace}>
        <div className={styles.mainColumn}>
          {prefillWarning && <div className={styles.warningCard} role="alert">⚠ &nbsp;{prefillWarning}</div>}
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><span className={styles.sectionNumber}>1</span><div><h2>Chọn quầy thu ngân</h2><p>Chỉ quầy ACTIVE, chưa có phiên OPEN/CLOSING và có ngăn kéo hoạt động mới được chọn.</p></div></div>
            <div className={styles.registerGrid} role="radiogroup" aria-label="Danh sách quầy thu ngân">{registers.map((register) => <RegisterCard key={register.id} register={register} sessions={sessions} selected={register.id === selectedId} onSelect={() => setSelection(register.id)} />)}</div>
            {registers.length === 0 && <div className={styles.emptyCard}>Chi nhánh này chưa có quầy thu ngân.</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionTitle}><span className={styles.sectionNumber}>2</span><div><h2>Nhân viên phụ trách</h2><p>Người đang đăng nhập sẽ được ghi nhận là cashier của phiên.</p></div></div>
            <div className={styles.cashierCard}>
              <span className={styles.avatar}>{initials(authContext?.user.displayName ?? "?")}</span>
              <div className={styles.cashierInfo}><strong>{authContext?.user.displayName ?? "Đang tải tài khoản"}</strong><span>{authContext?.authorization.roles?.join(" · ") || "Tài khoản hiện tại"}</span><span className={styles.greenText}><i />Đang làm việc</span></div>
              <dl className={styles.detailList}><div><dt>Chi nhánh</dt><dd>{branchName}</dd></div><div><dt>Quyền mở phiên</dt><dd className={hasPermission ? styles.greenText : styles.redText}>{hasPermission ? "Được cấp" : "Chưa được cấp"}</dd></div><div><dt>Ngày làm việc</dt><dd>{displayDate()}</dd></div></dl>
            </div>
            <p className={styles.readOnlyHint}>Không thể chọn nhân viên khác tại màn hình này. Backend luôn ghi nhận <code>auth.userId</code> làm cashier.</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionTitle}><span className={styles.sectionNumber}>3</span><div><h2>Tiền mặt đầu ca</h2><p>Số dư tiền mặt có sẵn trong ngăn kéo khi bắt đầu phiên.</p></div></div>
            <div className={styles.moneyGrid}>
              <div className={styles.amountBox}>
                <label htmlFor="opening-float">Số tiền mở ca <span>({currency})</span></label>
                <div className={styles.amountInput}><input id="opening-float" inputMode="numeric" value={openingDraft} onChange={(event) => setOpeningDraft(event.target.value.replace(/\D/g, ""))} aria-describedby="opening-float-help" /><span>{formatMoney(openingMinor, currency)}</span></div>
                <small id="opening-float-help">Cho phép bằng 0. API nhận số nguyên theo minor unit của {currency}.</small>
                <div className={styles.quickAmounts}>{quickAmounts.map((value) => <button type="button" key={value} onClick={() => setAmount(value)}>{formatMoney(value, currency)}</button>)}</div>
              </div>
              <div className={styles.denominationsBox}>
                <div className={styles.subHeading}><strong>Chi tiết tiền mặt</strong><span>Tính cục bộ</span></div>
                {denominations(currency).slice(0, 6).map((value) => <label className={styles.denominationRow} key={value}><span>{formatMoney(value, currency)}</span><input type="number" min="0" step="1" value={denominationCounts[value] ?? 0} onChange={(event) => setDenominationCounts((current) => ({ ...current, [value]: Math.max(0, parseInteger(event.target.value)) }))} aria-label={`Số lượng mệnh giá ${formatMoney(value, currency)}`} /><b>{formatMoney(value * (denominationCounts[value] ?? 0), currency)}</b></label>)}
                <div className={styles.denominationTotal}><span>Tổng kiểm đếm cục bộ</span><strong>{formatMoney(denominationTotal, currency)}</strong></div>
                <button className={styles.linkButton} type="button" onClick={() => setAmount(denominationTotal)}>Dùng tổng này →</button>
              </div>
            </div>
            {!selectedDrawer && <div className={styles.inlineWarning}>Chọn một ngăn kéo tiền mặt đang hoạt động trước khi nhập tiền đầu ca.</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionTitle}><span className={styles.sectionNumber}>4</span><div><h2>Kiểm tra trước khi mở phiên</h2><p>Chỉ các tín hiệu đọc được từ hệ thống mới được dùng để bật nút xác nhận.</p></div></div>
            <ul className={styles.readinessList}>
              <ReadinessRow label="Quầy hợp lệ" detail={readyRegister ? `${selectedRegister?.name} · ${selectedRegister?.code}` : "Chưa chọn quầy sẵn sàng"} state={readyRegister ? "ok" : "warn"} />
              <ReadinessRow label="Ngăn kéo tiền mặt" detail={readyDrawer ? `${selectedDrawer?.code} · ${selectedDrawer?.currency}` : selectedRegister ? "Chưa chọn ngăn kéo hoạt động" : "Chọn quầy để xem ngăn kéo"} state={readyDrawer ? "ok" : "warn"} />
              <ReadinessRow label="Quyền mở phiên" detail={hasPermission ? "Tài khoản có cash_session.open" : "Tài khoản hiện tại chưa có quyền"} state={hasPermission ? "ok" : "warn"} />
              <ReadinessRow label="Thiết bị đăng nhập" detail={deviceState === "ready" ? "Phiên thiết bị hợp lệ và được phép truy cập" : deviceState === "loading" ? "Đang kiểm tra quyền truy cập thiết bị…" : deviceError || "Chưa kiểm tra"} state={deviceState === "ready" ? "ok" : deviceState === "blocked" ? "warn" : "muted"} />
              <ReadinessRow label="Kết nối" detail={online ? "Đang trực tuyến" : "Mất kết nối mạng"} state={online ? "ok" : "warn"} />
            </ul>
          </section>

          <section className={styles.confirmPanel}>
            <div className={styles.sectionTitle}><span className={styles.sectionNumber}>5</span><div><h2>Xác nhận mở phiên</h2><p>Hai xác nhận này là bắt buộc để bảo vệ số dư đầu ca.</p></div></div>
            <label className={styles.confirmRow}><input type="checkbox" checked={cashConfirmed} onChange={(event) => setCashConfirmed(event.target.checked)} /><span><strong>Tôi đã kiểm đếm và xác nhận số tiền mặt đầu ca là chính xác.</strong><small>Số tiền sẽ được ghi nhận vào movement OPENING_FLOAT.</small></span></label>
            <label className={styles.confirmRow}><input type="checkbox" checked={registerConfirmed} onChange={(event) => setRegisterConfirmed(event.target.checked)} /><span><strong>Tôi đã kiểm tra đúng quầy và ngăn kéo thu ngân.</strong><small>Mọi giao dịch trong ca sẽ gắn với lựa chọn này.</small></span></label>
            {actionError && <div className={styles.actionError} role="alert">{actionError}</div>}
          </section>
        </div>

        <aside className={styles.rail} aria-label="Tóm tắt phiên">
          <section className={styles.railCard}>
            <div className={styles.railTitle}><h2>Quầy được chọn</h2><span className={styles.livePill}>{selectedRegister ? statusLabel(selectedState) : "Chưa chọn"}</span></div>
            <div className={styles.selectedRegister}><span className={styles.selectedGlyph}>▣</span><div><strong>{selectedRegister?.name ?? "Chưa chọn quầy"}</strong><small>{selectedRegister?.code ?? "Chọn một quầy ở bên trái"}</small></div></div>
            <dl className={styles.summaryList}><div><dt>Chi nhánh</dt><dd>{branchName}</dd></div><div><dt>Ngăn kéo</dt><dd>{selectedDrawer ? `${selectedDrawer.code} · ${selectedDrawer.currency}` : "Chưa chọn"}</dd></div><div><dt>Thiết bị</dt><dd className={deviceState === "ready" ? styles.greenText : styles.amberText}>{deviceState === "ready" ? "Đã xác minh" : deviceState === "loading" ? "Đang kiểm tra" : "Cần kiểm tra"}</dd></div></dl>
          </section>

          <section className={styles.railCard}>
            <h2>Tóm tắt phiên</h2>
            <dl className={styles.summaryList}><div><dt>Quầy</dt><dd>{selectedRegister?.code ?? "—"}</dd></div><div><dt>Nhân viên</dt><dd>{authContext?.user.displayName ?? "—"}</dd></div><div><dt>Bắt đầu</dt><dd>Khi xác nhận</dd></div><div><dt>Tiền đầu ca</dt><dd>{formatMoney(openingMinor, currency)}</dd></div></dl>
            <div className={styles.sessionPlaceholder}><span>Mã phiên sẽ được tạo tự động</span><strong>Sau khi mở thành công</strong></div>
          </section>

          <section className={styles.railCard}>
            <h2>Cách tính tiền trong phiên</h2>
            <ol className={styles.flowList}><li><span className={styles.flowPink}>1</span><span>Tiền đầu ca</span><strong>{formatMoney(openingMinor, currency)}</strong></li><li><span className={styles.flowGreen}>2</span><span>Thu tiền mặt</span><strong>Phát sinh sau</strong></li><li><span className={styles.flowAmber}>3</span><span>Hoàn tiền / chi tiền</span><strong>Phát sinh sau</strong></li><li><span className={styles.flowPink}>4</span><span>Tiền mặt dự kiến cuối ca</span><strong>Đối soát cuối ca</strong></li></ol>
          </section>

          <section className={styles.railCard}>
            <h2>Quy trình phiên thu ngân</h2>
            <ol className={styles.stepper}><li className={styles.stepActive}><b>1</b><span>Mở phiên</span><em>Đang thực hiện</em></li><li><b>2</b><span>Nhận thanh toán</span></li><li><b>3</b><span>Theo dõi tiền mặt</span></li><li><b>4</b><span>Kiểm đếm cuối ca</span></li><li><b>5</b><span>Đối soát & đóng phiên</span></li></ol>
            <div className={styles.securityHint}>⌁ &nbsp; Mã phiên, số ca và số liệu thu sẽ lấy từ API sau khi tạo thành công.</div>
          </section>
        </aside>
      </div>}

      <footer className={styles.stickyFooter}>
        <button className={styles.footerSecondary} type="button" onClick={() => { window.location.href = "/admin/pos/registers"; }}>← &nbsp;Quản lý quầy thu ngân</button>
        <div><button className={styles.footerSecondary} type="button" onClick={() => { window.location.href = "/admin/pos/registers"; }}>Hủy</button><button className={styles.footerPrimary} type="button" disabled={!canSubmit} onClick={() => void submit()}>{submitting ? "Đang mở phiên…" : `Mở phiên ${selectedRegister ? selectedRegister.name : "thu ngân"} · ${formatMoney(openingMinor, currency)}`}</button></div>
      </footer>
    </main>
  );
}
