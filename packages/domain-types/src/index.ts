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

export type AnalyticsFreshnessStatus = "FRESH" | "DELAYED" | "STALE" | "REBUILDING" | "DEGRADED";
export type AnalyticsComparisonMode = "NONE" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "CUSTOM_RANGE";
export interface AnalyticsMetadata {
  asOf: string;
  timezone: string;
  currency: string;
  metricVersion: number;
  projectionRevision: number;
  lastSuccessfulRefreshAt: string | null;
  freshnessStatus: AnalyticsFreshnessStatus;
  lagSeconds: number | null;
}
export interface AnalyticsKpiSummary {
  gross_sales_minor: string;
  discount_minor: string;
  net_sales_minor: string;
  tax_collected_minor: string;
  tips_minor: string;
  payments_collected_minor: string;
  completed_appointments: string;
  bookings_created: string;
}
export interface AnalyticsCommandCenterResponse {
  kpis: AnalyticsKpiSummary;
  trend: Array<{ businessDate: string; branchId: string; netSalesMinor: string }>;
  branches: Array<{ branchId: string; branchName: string; netSalesMinor: string }>;
  alerts: unknown[];
  metadata: AnalyticsMetadata;
}
export function currencyMinorUnit(currency: string): number {
  const normalized = currency.trim().toUpperCase();
  if (["VND", "JPY", "KRW"].includes(normalized)) return 0;
  return 2;
}
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

export interface AuthContext {
  user: { id: string; displayName: string; locale: Locale };
  workspace: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    membershipId: string;
    accessMode: string;
  };
  authorization: {
    roles: Role[];
    permissions: string[];
    branchIds: string[];
    ownStaffId?: string;
  };
  branches: Array<{ id: string; name: string; status: string }>;
  supportAccess?: { grantId: string; permissions: string[]; branchIds: string[] };
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string; timestamp: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export type TimeClockEventType =
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "BREAK_START"
  | "BREAK_END"
  | "MANUAL_SESSION_OPEN"
  | "MANUAL_SESSION_CLOSE"
  | "EVENT_VOID_REQUESTED"
  | "EVENT_VOID_APPROVED";
export type AttendanceSessionState =
  "OPEN" | "CLOSED" | "REVIEW_REQUIRED" | "ADJUSTED" | "VOIDED";
export type TimesheetState =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "LOCKED" | "REOPENED";
export type PayrollRunState =
  | "DRAFT"
  | "CALCULATING"
  | "CALCULATED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "FINALIZED"
  | "VOID_PENDING"
  | "VOIDED"
  | "FAILED";
export interface TimeClockStatus {
  clockedIn: boolean;
  serverNow: string;
  session: Record<string, unknown> | null;
}
export interface PayStatementSummary {
  id: string;
  staffId: string;
  netPayMinor: string;
  currency: string;
  paymentStatus: "UNPAID" | "PROCESSING" | "PAID" | "REVERSED";
  generatedAt: string;
}
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
  | "CHECKED_IN"
  | "IN_SERVICE"
  | "PARTIALLY_COMPLETED"
  | "COMPLETED"
  | "CHECKED_OUT"
  | "PAID"
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
  checkoutReady?: boolean;
}

export type WalkInStatus =
  "WAITING" | "READY" | "CALLED" | "CONVERTED" | "CANCELLED" | "LEFT";
export type ServiceSessionStatus =
  "PENDING" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED";
export interface WalkInSummary {
  id: string;
  branchId: string;
  queueNumber: number;
  localQueueDate: string;
  status: WalkInStatus;
  priority: "NORMAL" | "RECOVERY" | "MANAGER_OVERRIDE";
  estimatedStartAt?: string;
  estimatedWaitMinutes?: number;
  estimateGeneratedAt?: string;
  estimateDisclaimer: "ESTIMATED_NOT_GUARANTEED";
  estimateConfidence?: "LOW" | "MEDIUM" | "HIGH";
  estimateReasonCodes?: string[];
  version: number;
}
export interface ServiceSessionSummary {
  id: string;
  appointmentId: string;
  appointmentItemId: string;
  branchId: string;
  status: ServiceSessionStatus;
  actualStartedAt?: string;
  actualEndedAt?: string;
  totalPauseSeconds: number;
  actualWorkSeconds: number;
  version: number;
}

export type GiftCardStatus =
  | "PENDING_ACTIVATION"
  | "ACTIVE"
  | "SUSPENDED"
  | "DEPLETED"
  | "EXPIRED"
  | "CANCELLED"
  | "REPLACED";
export type StoredValueAccountType = "GIFT_CARD" | "CUSTOMER_CREDIT";
export interface StoredValueBalance {
  accountId: string;
  accountType: StoredValueAccountType;
  currency: string;
  pendingMinor: string;
  availableMinor: string;
  reservedMinor: string;
  redeemedMinor: string;
  liabilityMinor: string;
  version: number;
}
export interface GiftCardSummary {
  id: string;
  cardReference: string;
  maskedNumber: string;
  customerId?: string;
  status: GiftCardStatus;
  currency: string;
  expiresAt?: string;
  balance: StoredValueBalance;
  version: number;
}

export type PosOrderStatus =
  | "DRAFT"
  | "READY_FOR_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "VOIDED"
  | "EXPIRED";
export type PaymentTender =
  "CASH" | "CARD_EXTERNAL" | "BANK_TRANSFER" | "OTHER_EXTERNAL";
export type CashSessionStatus = "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
export interface MoneyTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
  tipMinor: number;
  grandTotalMinor: number;
  amountPaidMinor: number;
  amountDueMinor: number;
  currency: string;
}
export interface PosOrderSummary extends MoneyTotals {
  id: string;
  branchId: string;
  appointmentId?: string;
  orderNumber: string;
  source: "APPOINTMENT" | "WALK_IN" | "COUNTER_SALE" | "MANUAL";
  status: PosOrderStatus;
  pricingLockedAt?: string;
  version: number;
}
export interface PaymentSummary {
  id: string;
  orderId: string;
  paymentReference: string;
  tenderType: PaymentTender;
  status:
    | "PENDING"
    | "AUTHORIZED"
    | "CAPTURED"
    | "FAILED"
    | "CANCELLED"
    | "REVERSED_TECHNICAL";
  capturedMinor: number;
  cashReceivedMinor?: number;
  changeDueMinor?: number;
  currency: string;
  createdAt: string;
}

export type VoucherCampaignStatus =
  "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED";
export type BenefitReservationStatus =
  "ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED" | "CANCELLED";
export interface BenefitCandidate {
  id: string;
  eligible: boolean;
  reasonCodes: string[];
  calculatedAmountMinor?: number;
  calculatedUnits?: number;
  expiresAt?: string;
  policySnapshot: Record<string, unknown>;
}
export interface BenefitsEligibilityResult {
  generatedAt: string;
  applicationOrder: ["PACKAGE", "MEMBERSHIP", "VOUCHER", "LOYALTY"];
  vouchers: BenefitCandidate[];
  loyalty: {
    availablePoints: number;
    maxRedeemablePoints: number;
    maxRedeemableMinor: number;
    reasonCodes: string[];
  };
  membership: {
    tierId: string | null;
    benefits: Array<Record<string, unknown>>;
  };
  packages: BenefitCandidate[];
}
export interface CustomerBenefitWallet {
  customerId: string;
  membership: Record<string, unknown> | null;
  vouchers: Array<Record<string, unknown>>;
  loyalty: Record<string, unknown> | null;
  packages: Array<Record<string, unknown>>;
  expiringSoon: Array<Record<string, unknown>>;
}

export type InventoryItemType = "CONSUMABLE" | "RETAIL" | "BOTH";
export type InventoryLotStatus =
  "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "EXPIRED" | "DEPLETED";
export type InventoryReservationStatus =
  "ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED" | "CANCELLED";
/** Exact decimal returned as text; consumers must not coerce this to JS Number. */
export type InventoryQuantity = string;
/** Integer minor units returned as text to preserve bigint precision. */
export type MoneyMinorString = string;
export interface InventoryStockRow {
  id: string;
  branchId: string;
  locationId: string;
  itemId: string;
  lotId?: string;
  onHand: InventoryQuantity;
  reserved: InventoryQuantity;
  available: InventoryQuantity;
  averageUnitCostMinor?: InventoryQuantity;
  totalCostMinor?: InventoryQuantity;
  version: string;
}
export interface PurchaseOrderSummary {
  id: string;
  branchId: string;
  supplierId: string;
  poNumber: string;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "APPROVED"
    | "PARTIALLY_RECEIVED"
    | "RECEIVED"
    | "CANCELLED";
  currency: string;
  subtotalMinor: MoneyMinorString;
  version: number;
}
