/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { currencyMinorUnit } from "@nailsoft/domain-types";
import { authorizedFetch } from "../auth";
import styles from "./appointment-add-service.module.css";

type ViewState = "loading" | "ready" | "error" | "forbidden" | "offline";
type PlanState =
  "idle" | "planning" | "ready" | "holding" | "held" | "committing";
type StaffPreference = { type: "ANY" } | { type: "SPECIFIC"; staffId: string };

const ADD_SERVICE_STATES = new Set([
  "CHECKED_IN",
  "IN_SERVICE",
  "PARTIALLY_COMPLETED",
]);

function unwrap(value: any): any {
  return value?.data ?? value;
}

function list(value: any): any[] {
  const data = unwrap(value);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
}

async function read(path: string, optional = false) {
  const response = await authorizedFetch(path);
  const body = await response.json().catch(() => ({}));
  if (optional && response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Bạn không có quyền truy cập dữ liệu này."), {
      forbidden: true,
      code: body?.error?.code,
    });
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể tải dữ liệu."),
      {
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  return unwrap(body);
}

async function write(path: string, payload: unknown, idempotencyKey?: string) {
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      new Error("Bạn không có quyền thực hiện thao tác này."),
      {
        forbidden: true,
        code: body?.error?.code,
      },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message ?? "Không thể thực hiện thao tác."),
      {
        code: body?.error?.code,
        status: response.status,
      },
    );
  }
  return unwrap(body);
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function serviceName(service: any) {
  if (!service) return "Dịch vụ";
  if (typeof service === "string") return service;
  const name = service.name ?? service.displayName;
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    return (
      name["vi-VN"] ??
      name.vi ??
      name.en ??
      Object.values(name)[0] ??
      service.code ??
      "Dịch vụ"
    );
  }
  return service.code ?? "Dịch vụ";
}

function serviceDescription(service: any) {
  const description = service?.description;
  if (typeof description === "string") return description;
  if (description && typeof description === "object")
    return (
      description["vi-VN"] ??
      description.vi ??
      description.en ??
      Object.values(description)[0] ??
      ""
    );
  return "";
}

function initials(value: unknown) {
  const result = String(value ?? "?")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part.slice(0, 1))
    .join("")
    .toUpperCase();
  return result || "?";
}

function money(value: unknown, currency = "VND") {
  if (value == null || value === "") return "—";
  const digits = currencyMinorUnit(currency);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
  }).format(Number(value) / 10 ** digits);
}

function minutes(start?: string, end?: string) {
  if (!start || !end) return null;
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

function time(value?: string, timezone = "UTC") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function date(value?: string, timezone = "UTC") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function errorText(cause: any) {
  switch (cause?.code) {
    case "ADD_SERVICE_NOT_AVAILABLE":
      return "Lịch hẹn hiện không ở trạng thái cho phép thêm dịch vụ.";
    case "ADD_SERVICE_VERSION_CONFLICT":
    case "BOOKING_VERSION_CONFLICT":
    case "APPOINTMENT_VERSION_CONFLICT":
    case "VERSION_CONFLICT":
      return "Lịch hẹn vừa thay đổi bởi người khác. Đã tải lại dữ liệu; hãy kiểm tra và lập kế hoạch lại.";
    case "AVAILABILITY_CHANGED":
    case "SLOT_UNAVAILABLE":
    case "SLOT_HOLD_EXPIRED":
      return "Khung giờ hoặc dữ liệu khả dụng đã thay đổi. Vui lòng lập kế hoạch lại.";
    case "BRANCH_INACTIVE":
      return "Chi nhánh hiện không hoạt động nên chưa thể thêm dịch vụ.";
    case "ADD_SERVICE_INVALID_RELATION":
      return "Dịch vụ này không phải add-on hợp lệ của dịch vụ đã chọn.";
    default:
      return cause?.message ?? "Không thể hoàn tất thao tác.";
  }
}

function errorState(cause: any): ViewState {
  if (cause?.forbidden) return "forbidden";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  return "error";
}

function Card({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={`${styles.card} ${className}`}>
      <header className={styles.cardHeader}>
        <div>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {action ? <div className={styles.cardAction}>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Avatar({
  name,
  accent = "rose",
}: {
  name: unknown;
  accent?: "rose" | "violet" | "green";
}) {
  const accentClass =
    accent === "violet"
      ? styles.avatarViolet
      : accent === "green"
        ? styles.avatarGreen
        : styles.avatarRose;
  return (
    <span className={`${styles.avatar} ${accentClass}`}>{initials(name)}</span>
  );
}

function StateBox({
  state,
  error,
  retry,
}: {
  state: ViewState;
  error: string;
  retry: () => void;
}) {
  if (state === "loading")
    return (
      <div className={styles.loadingBox}>
        <span className={styles.spinner} />
        Đang tải dữ liệu lịch hẹn…
      </div>
    );
  return (
    <div className={styles.stateBox} role="alert">
      <strong>
        {state === "forbidden"
          ? "Không có quyền truy cập"
          : "Không thể tải màn hình"}
      </strong>
      <span>
        {error ||
          (state === "offline"
            ? "Thiết bị đang offline."
            : "Vui lòng thử lại.")}
      </span>
      <button type="button" className={styles.outlineButton} onClick={retry}>
        Thử lại
      </button>
    </div>
  );
}

function ServiceRow({ item, timezone }: { item: any; timezone: string }) {
  return (
    <div className={styles.serviceRow}>
      <span className={styles.serviceIcon}>✦</span>
      <div className={styles.serviceRowMain}>
        <strong>{serviceName(item.service)}</strong>
        <span>
          {item.service?.code ?? ""}{" "}
          {item.service?.durationMin
            ? `· ${item.service.durationMin} phút`
            : ""}
        </span>
      </div>
      <span className={styles.muted}>
        {time(item.serviceStartAt, timezone)} –{" "}
        {time(item.serviceEndAt, timezone)}
      </span>
      <span className={styles.servicePrice}>
        {money(item.price?.amountMinor, item.price?.currency)}
      </span>
      <span className={styles.statusPill}>
        {item.staff?.displayName ?? "Đã phân công"}
      </span>
    </div>
  );
}

function AppointmentContext({
  appointment,
  branch,
  timezone,
}: {
  appointment: any;
  branch: any;
  timezone: string;
}) {
  return (
    <Card
      title="Lịch hẹn hiện tại"
      eyebrow={`#${text(appointment.bookingReference)}`}
      className={styles.contextCard}
    >
      <div className={styles.contextGrid}>
        <div className={styles.customerBlock}>
          <Avatar name={appointment.contact?.displayName} />
          <div>
            <strong>
              {text(appointment.contact?.displayName, "Khách hàng")}
            </strong>
            <span>{text(appointment.contact?.phone)}</span>
            <div className={styles.tagRow}>
              <span className={styles.tag}>Khách đang phục vụ</span>
              <span className={`${styles.tag} ${styles.tagGreen}`}>
                {text(appointment.status)}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.contextItem}>
          <span>Thời gian</span>
          <strong>{date(appointment.startAt, timezone)}</strong>
          <b>
            {time(appointment.startAt, timezone)} –{" "}
            {time(appointment.endAt, timezone)}
          </b>
          <small>
            {minutes(appointment.startAt, appointment.endAt) ?? "—"} phút
          </small>
        </div>
        <div className={styles.contextItem}>
          <span>Chi nhánh</span>
          <strong>{text(branch?.name, text(appointment.branchId))}</strong>
          <small>{timezone}</small>
        </div>
        <div className={styles.contextItem}>
          <span>Version</span>
          <strong>#{text(appointment.version)}</strong>
          <small>Dùng để chống ghi đè</small>
        </div>
      </div>
    </Card>
  );
}

function ExistingServices({
  appointment,
  timezone,
}: {
  appointment: any;
  timezone: string;
}) {
  const items = appointment.items ?? [];
  return (
    <Card
      title="A. Dịch vụ trong lịch hẹn"
      action={<span className={styles.counter}>{items.length} dịch vụ</span>}
    >
      <div className={styles.serviceList}>
        {items.map((item: any) => (
          <ServiceRow key={item.id} item={item} timezone={timezone} />
        ))}
      </div>
      {!items.length ? (
        <p className={styles.emptyText}>Chưa có dịch vụ trong lịch hẹn.</p>
      ) : null}
      <div className={styles.totalBar}>
        <span>Hiện tại</span>
        <strong>
          {items.length} dịch vụ ·{" "}
          {minutes(appointment.startAt, appointment.endAt) ?? "—"} phút
        </strong>
        <strong>
          {money(
            appointment.pricingSummary?.amountMinor,
            appointment.pricingSummary?.currency,
          )}
        </strong>
      </div>
    </Card>
  );
}

function CatalogCard({
  service,
  selected,
  disabled,
  onSelect,
}: {
  service: any;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={`${styles.catalogCard} ${selected ? styles.catalogSelected : ""}`}
    >
      <div
        className={`${styles.catalogImage} ${selected ? styles.catalogImageSelected : ""}`}
      >
        ✦
      </div>
      <div className={styles.catalogBody}>
        <h3>{serviceName(service)}</h3>
        <p>
          {serviceDescription(service) ||
            "Dịch vụ đang hoạt động trong danh mục."}
        </p>
        <div className={styles.catalogMeta}>
          <span>◷ {text(service.defaultDurationMin, "—")} phút</span>
          <span>Giá theo planner</span>
        </div>
        <button
          type="button"
          className={selected ? styles.selectedButton : styles.addButton}
          disabled={disabled}
          onClick={onSelect}
        >
          {selected ? "Đã chọn ✓" : "+ Thêm"}
        </button>
      </div>
    </article>
  );
}

function ServiceCatalog({
  services,
  categories,
  query,
  setQuery,
  category,
  setCategory,
  selectedServiceId,
  planning,
  onSelect,
}: {
  services: any[];
  categories: any[];
  query: string;
  setQuery: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  selectedServiceId?: string | undefined;
  planning: boolean;
  onSelect: (service: any) => void;
}) {
  const filtered = useMemo(
    () =>
      services.filter((service) => {
        const haystack =
          `${serviceName(service)} ${service.code ?? ""} ${serviceDescription(service)}`.toLowerCase();
        return (
          (!query.trim() || haystack.includes(query.toLowerCase())) &&
          (!category || service.categoryId === category)
        );
      }),
    [services, query, category],
  );
  return (
    <Card
      title="B. Chọn dịch vụ muốn thêm"
      action={
        <span className={styles.counter}>
          {services.length} dịch vụ hoạt động
        </span>
      }
    >
      <div className={styles.searchRow}>
        <label className={styles.searchBox}>
          <span>⌕</span>
          <input
            aria-label="Tìm dịch vụ"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm dịch vụ theo tên hoặc mã…"
          />
        </label>
        <select
          aria-label="Lọc danh mục"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">Tất cả danh mục</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {serviceName(item)}
            </option>
          ))}
        </select>
        <select aria-label="Sắp xếp dịch vụ" defaultValue="popular">
          <option value="popular">Phổ biến nhất</option>
          <option value="name">Tên A–Z</option>
          <option value="duration">Thời lượng</option>
        </select>
      </div>
      <div className={styles.chipRow}>
        <button
          type="button"
          className={`${styles.filterChip} ${!category ? styles.filterChipActive : ""}`}
          onClick={() => setCategory("")}
        >
          Tất cả
        </button>
        {categories.slice(0, 5).map((item) => (
          <button
            type="button"
            className={`${styles.filterChip} ${category === item.id ? styles.filterChipActive : ""}`}
            key={item.id}
            onClick={() => setCategory(item.id)}
          >
            {serviceName(item)}
          </button>
        ))}
      </div>
      <div className={styles.catalogGrid}>
        {filtered.map((service) => (
          <CatalogCard
            key={service.id}
            service={service}
            selected={service.id === selectedServiceId}
            disabled={planning}
            onSelect={() => onSelect(service)}
          />
        ))}
      </div>
      {!filtered.length ? (
        <p className={styles.emptyText}>
          Không có dịch vụ phù hợp bộ lọc hiện tại.
        </p>
      ) : null}
    </Card>
  );
}

function PendingService({
  service,
  plan,
  timezone,
  onClear,
}: {
  service?: any;
  plan: any;
  timezone: string;
  onClear: () => void;
}) {
  const item = plan?.items?.[0];
  return (
    <Card
      title="C. Dịch vụ sắp thêm"
      action={
        <button type="button" className={styles.textButton} onClick={onClear}>
          Xóa lựa chọn
        </button>
      }
      className={styles.pendingCard}
    >
      {service ? (
        <div className={styles.pendingService}>
          <div className={styles.pendingIcon}>✦</div>
          <div className={styles.pendingMain}>
            <strong>{serviceName(service)}</strong>
            <span>
              {text(
                item?.serviceSnapshot?.durationMin ??
                  service.defaultDurationMin,
                "—",
              )}{" "}
              phút ·{" "}
              {money(
                item?.priceSnapshot?.amountMinor,
                item?.priceSnapshot?.currency,
              )}
            </span>
            <small>
              {time(item?.serviceStartAt, timezone)} –{" "}
              {time(item?.serviceEndAt, timezone)} · {text(item?.staffId)}
            </small>
          </div>
          <span className={styles.pendingStatus}>Planner đã kiểm tra</span>
        </div>
      ) : (
        <p className={styles.emptyText}>
          Chọn một dịch vụ ở danh mục để lập kế hoạch.
        </p>
      )}
    </Card>
  );
}

function StrategyCard({ plan, timezone }: { plan: any; timezone: string }) {
  return (
    <Card title="D. Thời điểm thực hiện">
      <div className={styles.radioList}>
        <label className={`${styles.radioCard} ${styles.radioActive}`}>
          <input type="radio" checked readOnly />
          <span>
            <strong>Ngay sau dịch vụ hiện tại</strong>
            <small>
              {plan
                ? `Planner chọn ${date(plan.startAt, timezone)} · bắt đầu ${time(plan.startAt, timezone)}`
                : "Hệ thống sẽ kiểm tra mốc kết thúc thực tế."}
            </small>
          </span>
        </label>
        <label className={`${styles.radioCard} ${styles.radioDisabled}`}>
          <input type="radio" disabled />
          <span>
            <strong>Chèn vào lịch hiện tại</strong>
            <small>Chưa được API add-service hỗ trợ.</small>
          </span>
        </label>
        <label className={`${styles.radioCard} ${styles.radioDisabled}`}>
          <input type="radio" disabled />
          <span>
            <strong>Chọn thời gian khác</strong>
            <small>
              Màn này chỉ dùng khung giờ nối tiếp đã được planner xác nhận.
            </small>
          </span>
        </label>
      </div>
    </Card>
  );
}

function StaffCard({
  staff,
  selected,
  planState,
  onSelect,
}: {
  staff: any[];
  selected: StaffPreference;
  planState: PlanState;
  onSelect: (preference: StaffPreference) => void;
}) {
  const selectedId = selected.type === "SPECIFIC" ? selected.staffId : "";
  return (
    <Card
      title="A. Kỹ thuật viên phù hợp"
      eyebrow="Planner kiểm tra theo kỹ năng, lịch và tài nguyên"
    >
      <div className={styles.staffList}>
        <button
          type="button"
          className={`${styles.staffOption} ${selected.type === "ANY" ? styles.staffSelected : ""}`}
          disabled={planState === "planning" || planState === "holding"}
          onClick={() => onSelect({ type: "ANY" })}
        >
          <span className={styles.staffRadio}>
            {selected.type === "ANY" ? "●" : "○"}
          </span>
          <Avatar name="Bất kỳ" accent="violet" />
          <span className={styles.staffCopy}>
            <strong>Bất kỳ kỹ thuật viên</strong>
            <small>Để planner tự chọn người phù hợp</small>
          </span>
          <span className={styles.availablePill}>Planner</span>
        </button>
        {staff.slice(0, 8).map((item) => (
          <button
            type="button"
            key={item.id}
            className={`${styles.staffOption} ${selectedId === item.id ? styles.staffSelected : ""}`}
            disabled={planState === "planning" || planState === "holding"}
            onClick={() => onSelect({ type: "SPECIFIC", staffId: item.id })}
          >
            <span className={styles.staffRadio}>
              {selectedId === item.id ? "●" : "○"}
            </span>
            <Avatar name={item.displayName} accent="rose" />
            <span className={styles.staffCopy}>
              <strong>{text(item.displayName)}</strong>
              <small>
                {item.levelCode ? `Cấp ${item.levelCode} · ` : ""}được phân công
                tại chi nhánh
              </small>
            </span>
            <span className={styles.staffStatus}>
              {selectedId === item.id ? "Đang kiểm tra" : "Chọn"}
            </span>
          </button>
        ))}
      </div>
      {!staff.length ? (
        <p className={styles.emptyText}>
          Chưa tải được danh sách kỹ thuật viên; bạn vẫn có thể dùng lựa chọn
          Bất kỳ.
        </p>
      ) : null}
      <p className={styles.helperText}>
        Mỗi lần đổi kỹ thuật viên sẽ lập kế hoạch lại. UI không suy đoán trạng
        thái sẵn sàng nếu planner chưa xác nhận.
      </p>
    </Card>
  );
}

function AvailabilityCard({ plan, timezone }: { plan: any; timezone: string }) {
  const item = plan?.items?.[0];
  return (
    <Card
      title="B. Kiểm tra lịch kỹ thuật viên"
      action={
        plan ? (
          <span className={styles.successTiny}>✓ Đã kiểm tra realtime</span>
        ) : null
      }
    >
      {plan && item ? (
        <>
          <div className={styles.timelineHeader}>
            <span>{time(item.staffOccupancyStartAt, timezone)}</span>
            <span>{time(item.serviceStartAt, timezone)}</span>
            <span>{time(item.serviceEndAt, timezone)}</span>
            <span>{time(item.staffOccupancyEndAt, timezone)}</span>
          </div>
          <div className={styles.timeline}>
            <span className={styles.timelineEmpty} />
            <span className={styles.timelineSelected} />
            <span className={styles.timelineEmpty} />
          </div>
          <div className={styles.timelineLegend}>
            <span>
              <i className={styles.dotRose} />
              Khung giờ mới
            </span>
            <span>
              <i className={styles.dotGray} />
              Khoảng đệm/tài nguyên
            </span>
            <span>
              <i className={styles.dotGreen} />
              Đã planner xác nhận
            </span>
          </div>
          <div className={styles.availabilityNotice}>
            <strong>✓ Có thể thêm dịch vụ</strong>
            <span>
              {text(item.staffId)} · {time(item.serviceStartAt, timezone)} –{" "}
              {time(item.serviceEndAt, timezone)} · tài nguyên đã được planner
              kiểm tra.
            </span>
          </div>
        </>
      ) : (
        <div className={styles.emptyAvailability}>
          Chọn dịch vụ để kiểm tra staff, tài nguyên và khung giờ thực tế.
        </div>
      )}
    </Card>
  );
}

function CostSummary({
  appointment,
  plan,
  timezone,
}: {
  appointment: any;
  plan: any;
  timezone: string;
}) {
  const oldTotal = Number(appointment.pricingSummary?.amountMinor ?? 0);
  const addTotal = Number(
    plan?.total?.amountMinor ??
      plan?.items?.[0]?.priceSnapshot?.amountMinor ??
      0,
  );
  const currency =
    plan?.total?.currency ?? appointment.pricingSummary?.currency ?? "VND";
  const oldDuration = minutes(appointment.startAt, appointment.endAt);
  const newDuration = plan ? minutes(appointment.startAt, plan.endAt) : null;
  return (
    <>
      <Card title="D. Tóm tắt chi phí">
        <dl className={styles.summaryList}>
          <div>
            <dt>Dịch vụ hiện tại</dt>
            <dd>{money(oldTotal, currency)}</dd>
          </div>
          <div>
            <dt>Dịch vụ thêm</dt>
            <dd>{plan ? money(addTotal, currency) : "—"}</dd>
          </div>
          <div>
            <dt>Giảm giá</dt>
            <dd>—</dd>
          </div>
        </dl>
        <div className={styles.grandTotal}>
          <span>Tổng mới</span>
          <strong>{plan ? money(oldTotal + addTotal, currency) : "—"}</strong>
        </div>
        {plan ? (
          <span className={styles.positiveBadge}>Giá snapshot từ planner</span>
        ) : (
          <p className={styles.helperText}>
            Chưa hiển thị giá khi chưa lập kế hoạch.
          </p>
        )}
      </Card>
      <Card title="E. Thay đổi lịch hẹn">
        <dl className={styles.summaryList}>
          <div>
            <dt>Số dịch vụ</dt>
            <dd>
              {appointment.items?.length ?? 0} →{" "}
              {plan ? (appointment.items?.length ?? 0) + 1 : "—"}
            </dd>
          </div>
          <div>
            <dt>Thời lượng</dt>
            <dd>
              {oldDuration ?? "—"} → {newDuration ?? "—"} phút
            </dd>
          </div>
          <div>
            <dt>Kết thúc dự kiến</dt>
            <dd>
              {time(appointment.endAt, timezone)} →{" "}
              {plan ? time(plan.endAt, timezone) : "—"}
            </dd>
          </div>
          <div>
            <dt>Thời gian kéo dài</dt>
            <dd className={styles.positiveText}>
              {plan && oldDuration != null && newDuration != null
                ? `+${newDuration - oldDuration} phút`
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>
    </>
  );
}

function ImpactCard({ plan }: { plan: any }) {
  return (
    <Card title="F. Kiểm tra ảnh hưởng">
      {plan ? (
        <div className={styles.impactList}>
          <span>✓ Kỹ thuật viên đủ điều kiện</span>
          <span>✓ Không trùng lịch theo planner</span>
          <span>✓ Chi nhánh còn khả năng phục vụ</span>
          <span>✓ Dịch vụ có giá snapshot</span>
          <span className={styles.impactWarning}>
            ! Lịch hẹn sẽ được kéo dài theo kết quả planner
          </span>
        </div>
      ) : (
        <div className={styles.emptyAvailability}>
          Kết quả ảnh hưởng sẽ xuất hiện sau khi kiểm tra khung giờ.
        </div>
      )}
    </Card>
  );
}

function ConfirmationCard({
  note,
  setNote,
  approvalMethod,
  setApprovalMethod,
  first,
  second,
  setFirst,
  setSecond,
  canCommit,
  saving,
  onCommit,
  error,
}: {
  note: string;
  setNote: (value: string) => void;
  approvalMethod: string;
  setApprovalMethod: (value: string) => void;
  first: boolean;
  second: boolean;
  setFirst: (value: boolean) => void;
  setSecond: (value: boolean) => void;
  canCommit: boolean;
  saving: boolean;
  onCommit: () => void;
  error: string;
}) {
  return (
    <Card title="G. Xác nhận thêm dịch vụ" className={styles.confirmCard}>
      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={first}
          onChange={(event) => setFirst(event.target.checked)}
        />
        <span>Tôi đã xác nhận dịch vụ và giá với khách hàng.</span>
      </label>
      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={second}
          onChange={(event) => setSecond(event.target.checked)}
        />
        <span>Tôi đã kiểm tra thời gian và kỹ thuật viên phù hợp.</span>
      </label>
      <div className={styles.confirmFields}>
        <label>
          <span>Phương thức khách đồng ý</span>
          <select
            value={approvalMethod}
            onChange={(event) => setApprovalMethod(event.target.value)}
          >
            <option value="VERBAL">Trao đổi trực tiếp</option>
            <option value="DIGITAL">Xác nhận điện tử</option>
            <option value="WRITTEN">Xác nhận bằng văn bản</option>
          </select>
        </label>
        <label>
          <span>
            Ghi chú duyệt thêm dịch vụ{" "}
            <em>(được lưu trong lịch sử thay đổi)</em>
          </span>
          <textarea
            maxLength={4000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ví dụ: Khách đồng ý kéo dài lịch thêm 45 phút…"
            rows={3}
          />
        </label>
      </div>
      {error ? (
        <div className={styles.inlineError} role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className={styles.primaryButton}
        disabled={!canCommit || saving}
        onClick={onCommit}
      >
        {saving ? "Đang xác nhận…" : "Xác nhận thêm dịch vụ"}
      </button>
    </Card>
  );
}

function SuccessCard({
  appointment,
  result,
  plan,
  timezone,
}: {
  appointment: any;
  result: any;
  plan: any;
  timezone: string;
}) {
  const item = plan?.items?.[0];
  return (
    <Card title="Đã thêm dịch vụ thành công" className={styles.successCard}>
      <span className={styles.successMark}>✓</span>
      <h3>{serviceName(item?.serviceSnapshot)}</h3>
      <p>
        Lịch hẹn <strong>#{text(appointment.bookingReference)}</strong> đã được
        cập nhật sau khi hold được tiêu thụ và appointment version được kiểm
        tra.
      </p>
      <dl className={styles.successDetails}>
        <div>
          <dt>Kết thúc mới</dt>
          <dd>{time(result?.endAt ?? plan?.endAt, timezone)}</dd>
        </div>
        <div>
          <dt>Staff</dt>
          <dd>{text(item?.staffId)}</dd>
        </div>
        <div>
          <dt>Mã dịch vụ</dt>
          <dd>{text(result?.appointmentItemId)}</dd>
        </div>
      </dl>
      <div className={styles.successActions}>
        <a
          className={styles.outlineButton}
          href={`/admin/appointments/${appointment.id}/overview`}
        >
          Quay lại lịch hẹn
        </a>
        {result?.appointmentItemId ? (
          <a
            className={styles.primaryButton}
            href={`/admin/appointments/${appointment.id}/execution`}
          >
            Mở quy trình phục vụ
          </a>
        ) : null}
      </div>
      <p className={styles.helperText}>
        Màn này không tự động bắt đầu service session; nhân viên chỉ bắt đầu từ
        quy trình phục vụ.
      </p>
    </Card>
  );
}

export default function AppointmentAddServicePage({
  appointmentId,
}: {
  appointmentId: string;
}) {
  const [appointment, setAppointment] = useState<any>();
  const [branch, setBranch] = useState<any>();
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [pageState, setPageState] = useState<ViewState>("loading");
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>();
  const [staffPreference, setStaffPreference] = useState<StaffPreference>({
    type: "ANY",
  });
  const [plan, setPlan] = useState<any>();
  const [planState, setPlanState] = useState<PlanState>("idle");
  const [hold, setHold] = useState<any>();
  const [committed, setCommitted] = useState<any>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [approvalMethod, setApprovalMethod] = useState("VERBAL");
  const [firstConfirmed, setFirstConfirmed] = useState(false);
  const [secondConfirmed, setSecondConfirmed] = useState(false);
  const [, setClock] = useState(0);

  const load = useCallback(async () => {
    setPageState("loading");
    setPageError("");
    try {
      const detail = await read(
        `/v1/appointments/${encodeURIComponent(appointmentId)}`,
      );
      setAppointment(detail);
      const branchResult = await read(
        `/v1/branches/${encodeURIComponent(detail.branchId)}`,
        true,
      ).catch(() => null);
      setBranch(branchResult);
      const [servicesResult, categoriesResult, staffResult] =
        await Promise.allSettled([
          read(
            `/v1/services?status=ACTIVE&pageSize=100&branchId=${encodeURIComponent(detail.branchId)}`,
          ),
          read("/v1/service-categories?status=ACTIVE", true),
          read(
            `/v1/staff?status=ACTIVE&branchId=${encodeURIComponent(detail.branchId)}`,
            true,
          ),
        ]);
      if (servicesResult.status === "fulfilled")
        setServices(list(servicesResult.value));
      if (categoriesResult.status === "fulfilled")
        setCategories(list(categoriesResult.value));
      if (staffResult.status === "fulfilled") setStaff(list(staffResult.value));
      setPageState("ready");
    } catch (cause: any) {
      setPageError(cause?.message ?? "Không thể tải lịch hẹn.");
      setPageState(errorState(cause));
    }
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const timezone = branch?.timezone ?? "UTC";
  const selectedService = services.find(
    (item) => item.id === selectedServiceId,
  );
  const activeHold = Boolean(
    hold?.holdId &&
    hold?.status === "ACTIVE" &&
    hold?.expiresAt &&
    new Date(hold.expiresAt).getTime() > Date.now(),
  );
  const canPlan = Boolean(
    appointment && ADD_SERVICE_STATES.has(appointment.status),
  );
  const canCommit = Boolean(
    activeHold &&
    plan &&
    firstConfirmed &&
    secondConfirmed &&
    planState !== "committing",
  );

  const releaseHold = useCallback(async () => {
    if (!hold?.holdId || hold.status !== "ACTIVE") return;
    try {
      await write(
        `/v1/slot-holds/${encodeURIComponent(hold.holdId)}/release`,
        {},
        crypto.randomUUID(),
      );
    } catch {
      /* TTL still releases an abandoned hold. */
    }
    setHold(undefined);
  }, [hold]);

  const makePlan = async (
    service: any,
    preference: StaffPreference = staffPreference,
  ) => {
    if (!appointment || !canPlan) {
      setActionError("Lịch hẹn chưa ở trạng thái cho phép thêm dịch vụ.");
      return;
    }
    await releaseHold();
    setSelectedServiceId(service.id);
    setStaffPreference(preference);
    setPlan(undefined);
    setCommitted(undefined);
    setActionError("");
    setNotice("");
    setPlanState("planning");
    setFirstConfirmed(false);
    setSecondConfirmed(false);
    try {
      const result = await write(
        `/v1/appointments/${encodeURIComponent(appointmentId)}/add-service-plans`,
        { serviceId: service.id, staffPreference: preference },
      );
      setPlan({
        ...result,
        serviceId: service.id,
        staffPreference: preference,
      });
      setPlanState("ready");
      setNotice(
        "Đã revalidate staff, tài nguyên, khung giờ và giá snapshot. Chưa tạo hold hoặc thay đổi lịch hẹn.",
      );
    } catch (cause: any) {
      setPlanState("idle");
      setActionError(errorText(cause));
      if (
        [
          "ADD_SERVICE_VERSION_CONFLICT",
          "BOOKING_VERSION_CONFLICT",
          "VERSION_CONFLICT",
        ].includes(cause?.code)
      )
        await load();
    }
  };

  const holdSlot = async () => {
    if (!selectedServiceId || !plan || planState === "holding" || !canPlan)
      return;
    setPlanState("holding");
    setActionError("");
    try {
      const result = await write(
        `/v1/appointments/${encodeURIComponent(appointmentId)}/add-service-holds`,
        {
          serviceId: selectedServiceId,
          ...(plan.parentItemId ? { parentItemId: plan.parentItemId } : {}),
          staffPreference,
        },
        crypto.randomUUID(),
      );
      setHold(result);
      if (result?.plan)
        setPlan({
          ...result.plan,
          serviceId: selectedServiceId,
          staffPreference,
          scheduleImpact: plan.scheduleImpact,
        });
      setPlanState("held");
      setNotice(
        `Đã giữ khung giờ đến ${time(result.expiresAt, timezone)}. Hoàn tất xác nhận trước khi hold hết hạn.`,
      );
    } catch (cause: any) {
      setPlanState("ready");
      setActionError(errorText(cause));
    }
  };

  const commit = async () => {
    if (!appointment || !hold?.holdId || !canCommit) return;
    setPlanState("committing");
    setActionError("");
    try {
      const result = await write(
        `/v1/appointments/${encodeURIComponent(appointmentId)}/add-service`,
        {
          holdId: hold.holdId,
          version: appointment.version,
          ...(plan?.parentItemId ? { parentItemId: plan.parentItemId } : {}),
          customerApprovalMethod: approvalMethod,
          ...(note.trim() ? { approvalNote: note.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      setCommitted(result);
      setHold(undefined);
      setNotice("");
      await load();
    } catch (cause: any) {
      setPlanState(activeHold ? "held" : "ready");
      setActionError(errorText(cause));
      if (
        [
          "ADD_SERVICE_VERSION_CONFLICT",
          "BOOKING_VERSION_CONFLICT",
          "VERSION_CONFLICT",
          "SLOT_HOLD_EXPIRED",
          "AVAILABILITY_CHANGED",
        ].includes(cause?.code)
      ) {
        setHold(undefined);
        await load();
      }
    }
  };

  const clearSelection = async () => {
    await releaseHold();
    setSelectedServiceId(undefined);
    setPlan(undefined);
    setPlanState("idle");
    setFirstConfirmed(false);
    setSecondConfirmed(false);
    setActionError("");
    setNotice("");
  };
  const navigateBack = async () => {
    await releaseHold();
    window.location.href = `/admin/appointments/${encodeURIComponent(appointmentId)}/overview`;
  };

  if (pageState !== "ready")
    return (
      <div className={styles.page}>
        <div className={styles.pageInner}>
          <StateBox
            state={pageState}
            error={pageError}
            retry={() => void load()}
          />
        </div>
      </div>
    );
  if (!appointment) return null;

  return (
    <div className={styles.page} data-testid="appointment-add-service-page">
      <div className={styles.pageInner}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <a
            href={`/admin/appointments/${encodeURIComponent(appointmentId)}/overview`}
          >
            Lịch hẹn
          </a>
          <span>/</span>
          <strong>#{text(appointment.bookingReference)} / Thêm dịch vụ</strong>
        </nav>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.kicker}>LỊCH HẸN / DỊCH VỤ</p>
            <h1>Thêm dịch vụ</h1>
            <p>
              Bổ sung dịch vụ vào lịch hẹn và kiểm tra kỹ thuật viên, thời lượng
              cùng khả năng phục vụ trước khi xác nhận.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.outlineButton}
              onClick={() => void navigateBack()}
            >
              × Hủy thay đổi
            </button>
            {plan && !activeHold ? (
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={planState === "holding"}
                onClick={() => void holdSlot()}
              >
                ⌁ Kiểm tra & giữ khung giờ
              </button>
            ) : null}
            {activeHold ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!canCommit}
                onClick={() => void commit()}
              >
                ✓ Xác nhận thêm dịch vụ
              </button>
            ) : null}
          </div>
        </header>
        {actionError ? (
          <div className={styles.actionError} role="alert">
            <strong>Không thể tiếp tục</strong>
            <span>{actionError}</span>
          </div>
        ) : null}
        {notice ? (
          <div className={styles.notice} role="status">
            ✓ {notice}
          </div>
        ) : null}
        {!canPlan ? (
          <div className={styles.warningBanner}>
            <strong>
              Trạng thái {text(appointment.status)} chưa cho phép thêm dịch vụ.
            </strong>
            <span>
              Backend chỉ cho phép thao tác khi lịch hẹn đang CHECKED_IN,
              IN_SERVICE hoặc PARTIALLY_COMPLETED.
            </span>
          </div>
        ) : null}
        {committed ? (
          <SuccessCard
            appointment={appointment}
            result={committed}
            plan={plan}
            timezone={timezone}
          />
        ) : (
          <>
            <AppointmentContext
              appointment={appointment}
              branch={branch}
              timezone={timezone}
            />
            <div className={styles.layout}>
              <main className={styles.mainColumn}>
                <ExistingServices
                  appointment={appointment}
                  timezone={timezone}
                />
                <ServiceCatalog
                  services={services}
                  categories={categories}
                  query={query}
                  setQuery={setQuery}
                  category={category}
                  setCategory={setCategory}
                  selectedServiceId={selectedServiceId}
                  planning={planState === "planning"}
                  onSelect={(service) => void makePlan(service)}
                />
                <PendingService
                  service={selectedService}
                  plan={plan}
                  timezone={timezone}
                  onClear={() => void clearSelection()}
                />
                <StrategyCard plan={plan} timezone={timezone} />
                <ConfirmationCard
                  note={note}
                  setNote={setNote}
                  approvalMethod={approvalMethod}
                  setApprovalMethod={setApprovalMethod}
                  first={firstConfirmed}
                  second={secondConfirmed}
                  setFirst={setFirstConfirmed}
                  setSecond={setSecondConfirmed}
                  canCommit={canCommit}
                  saving={planState === "committing"}
                  onCommit={() => void commit()}
                  error={actionError}
                />
              </main>
              <aside className={styles.sideColumn}>
                <StaffCard
                  staff={staff}
                  selected={staffPreference}
                  planState={planState}
                  onSelect={(preference) => {
                    if (selectedService)
                      void makePlan(selectedService, preference);
                  }}
                />
                <AvailabilityCard plan={plan} timezone={timezone} />
                <CostSummary
                  appointment={appointment}
                  plan={plan}
                  timezone={timezone}
                />
                <ImpactCard plan={plan} />
              </aside>
            </div>
          </>
        )}
        {!committed ? (
          <div className={styles.stickyFooter}>
            <button
              type="button"
              className={styles.outlineButton}
              onClick={() => void navigateBack()}
            >
              ← Quay lại lịch hẹn
            </button>
            <div className={styles.footerActions}>
              {activeHold ? (
                <span className={styles.holdTimer}>
                  Đã giữ đến {time(hold.expiresAt, timezone)}
                </span>
              ) : null}
              {plan && !activeHold ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={planState === "holding"}
                  onClick={() => void holdSlot()}
                >
                  {planState === "holding"
                    ? "Đang giữ khung giờ…"
                    : "Kiểm tra & giữ khung giờ"}
                </button>
              ) : null}
              {activeHold ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!canCommit}
                  onClick={() => void commit()}
                >
                  {planState === "committing"
                    ? "Đang xác nhận…"
                    : `Thêm 1 dịch vụ · ${money(plan?.total?.amountMinor, plan?.total?.currency)}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
