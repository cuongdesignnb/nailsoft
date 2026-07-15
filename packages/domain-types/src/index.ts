export const roles = [
  "PLATFORM_SUPER_ADMIN",
  "SALON_OWNER",
  "BRANCH_MANAGER",
  "RECEPTIONIST",
  "CASHIER",
  "NAIL_TECHNICIAN",
  "ACCOUNTANT",
  "MARKETING",
  "CUSTOMER",
] as const;
export type Role = (typeof roles)[number];
export type Locale = "vi-VN" | "en-US";
export interface TenantContext {
  tenantId: string;
  branchId?: string;
  actorUserId: string;
  roles: Role[];
}
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string; timestamp: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export interface LocalOperation<T = unknown> {
  operationId: string;
  type: string;
  entityId: string;
  baseVersion: number;
  payload: T;
  createdAtDevice: string;
  syncStatus: "PENDING" | "SYNCING" | "COMPLETED" | "FAILED" | "CONFLICT";
}
export type AvailabilityReasonCode =
  | "BRANCH_CLOSED"
  | "OUTSIDE_BUSINESS_HOURS"
  | "SERVICE_INACTIVE"
  | "SERVICE_NOT_AVAILABLE_AT_BRANCH"
  | "NO_ACTIVE_PRICE"
  | "NO_ELIGIBLE_STAFF"
  | "STAFF_NOT_ASSIGNED"
  | "STAFF_NOT_BOOKABLE"
  | "STAFF_SKILL_MISSING"
  | "STAFF_PROFICIENCY_TOO_LOW"
  | "STAFF_SKILL_EXPIRED"
  | "NO_PUBLISHED_SHIFT"
  | "STAFF_ON_APPROVED_LEAVE"
  | "STAFF_BUSY"
  | "STAFF_RESERVED"
  | "RESOURCE_RESERVED"
  | "SLOT_HELD"
  | "RESOURCE_UNAVAILABLE"
  | "RESOURCE_CAPACITY_INSUFFICIENT"
  | "RESOURCE_MAINTENANCE"
  | "TIMEZONE_INVALID"
  | "DST_GAP"
  | "DST_AMBIGUOUS"
  | "INVALID_RANGE";
export interface AvailabilityQuery {
  branchId: string;
  serviceId: string;
  dateFrom: string;
  dateTo: string;
  staffId?: string;
  slotIntervalMin?: 5 | 10 | 15 | 30;
}
export interface AvailabilityResult {
  branchId: string;
  serviceId: string;
  timezone: string;
  generatedAt: string;
  validUntil: string;
  calculationVersion: number;
  dataVersion: number;
  cache: { hit: boolean; ttlSeconds: number };
  days: Array<{
    localDate: string;
    slots: Array<{
      startAt: string;
      endAt: string;
      localStart: string;
      localEnd: string;
      staffCandidates: Array<{
        staffId: string;
        displayName: string;
        qualificationScore: number;
      }>;
      resourceSummary: Array<{
        resourceTypeId: string;
        required: number;
        available: number;
      }>;
      priceReference?: {
        priceId: string;
        amount: string;
        currency: string;
        source: "BRANCH_PRICE" | "TENANT_DEFAULT";
      };
      fingerprint: string;
    }>;
    unavailableReasons?: Array<{ code: AvailabilityReasonCode; count: number }>;
  }>;
}
export interface AvailabilityExplainResult {
  available: boolean;
  startAt: string;
  timezone: string;
  reasons: Array<{ code: AvailabilityReasonCode; count: number }>;
  blockingReasons: Array<{ code: AvailabilityReasonCode; count: number }>;
  warnings: Array<{ code: AvailabilityReasonCode; count: number }>;
  rules: {
    businessHours: boolean;
    staff: boolean;
    resources: boolean;
    price: boolean;
    timezone: boolean;
  };
  resourceSummary: Array<{
    resourceTypeId: string;
    required: number;
    available: number;
  }>;
  staffCandidates: Array<{
    staffId: string;
    displayName: string;
    qualificationScore: number;
  }>;
}
export interface CalendarEvent {
  id: string;
  eventType:
    | "SHIFT"
    | "LEAVE"
    | "BUSY_BLOCK"
    | "RESOURCE_MAINTENANCE"
    | "AVAILABILITY_WINDOW"
    | "APPOINTMENT"
    | "SLOT_HOLD";
  branchId: string;
  staffId?: string;
  resourceId?: string;
  title: string;
  startAt: string;
  endAt: string;
  localStart: string;
  localEnd: string;
  status: string;
  sourceEntityType: string;
  sourceEntityId: string;
  version: number;
  metadata: Record<string, unknown>;
}
export interface AvailabilityBlock {
  id: string;
  branchId: string;
  staffId?: string;
  resourceId?: string;
  blockType: "MANUAL" | "EXTERNAL" | "MAINTENANCE" | "SYSTEM";
  title: string;
  startAt: string;
  endAt: string;
  status: "ACTIVE" | "CANCELLED" | "EXPIRED";
  version: number;
}
export type AppointmentStatus =
  | "DRAFT"
  | "PENDING_CONFIRMATION"
  | "PENDING_DEPOSIT"
  | "CONFIRMED"
  | "EXPIRED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_SALON";
export type SlotHoldStatus = "ACTIVE" | "CONSUMED" | "EXPIRED" | "RELEASED";
export type StaffPreference =
  { type: "ANY" } | { type: "SPECIFIC"; staffId: string };
export interface BookingPlanInput {
  branchId: string;
  desiredStartAt: string;
  items: Array<{
    serviceId: string;
    staffPreference: StaffPreference;
    availabilityFingerprint?: string;
  }>;
}
export interface BookingPlanItem {
  sequenceNo: number;
  serviceId: string;
  staffId: string;
  serviceStartAt: string;
  serviceEndAt: string;
  staffOccupancyStartAt: string;
  staffOccupancyEndAt: string;
  resourceOccupancyStartAt: string;
  resourceOccupancyEndAt: string;
  serviceSnapshot: Record<string, unknown>;
  priceSnapshot: Record<string, unknown>;
  taxSnapshot: Record<string, unknown>;
  resourceAllocations: Array<{
    resourceId: string;
    quantity: number;
    isExclusive: boolean;
  }>;
  availabilityFingerprint: string;
}
export interface BookingPlan {
  branchId: string;
  timezone: string;
  startAt: string;
  endAt: string;
  availabilityDataVersion: number;
  items: BookingPlanItem[];
  total: { amountMinor: number; amount: string; currency: string };
}
export interface SlotHold {
  holdId: string;
  status: SlotHoldStatus;
  expiresAt: string;
  version: number;
  plan: BookingPlan;
}
export interface AppointmentSummary {
  id: string;
  bookingReference: string;
  branchId: string;
  customerId?: string;
  status: AppointmentStatus;
  source: string;
  startAt: string;
  endAt: string;
  scheduleVersion: number;
  version: number;
  depositStatus: "NOT_REQUIRED" | "REQUIRED" | "PENDING" | "WAIVED";
  pricingSummary: Record<string, unknown>;
}
