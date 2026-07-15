export const AVAILABILITY_REASONS = [
  "BRANCH_CLOSED",
  "OUTSIDE_BUSINESS_HOURS",
  "SERVICE_INACTIVE",
  "SERVICE_NOT_AVAILABLE_AT_BRANCH",
  "NO_ACTIVE_PRICE",
  "NO_ELIGIBLE_STAFF",
  "STAFF_NOT_ASSIGNED",
  "STAFF_NOT_BOOKABLE",
  "STAFF_SKILL_MISSING",
  "STAFF_PROFICIENCY_TOO_LOW",
  "STAFF_SKILL_EXPIRED",
  "NO_PUBLISHED_SHIFT",
  "STAFF_ON_APPROVED_LEAVE",
  "STAFF_BUSY",
  "STAFF_RESERVED",
  "RESOURCE_RESERVED",
  "SLOT_HELD",
  "RESOURCE_UNAVAILABLE",
  "RESOURCE_CAPACITY_INSUFFICIENT",
  "RESOURCE_MAINTENANCE",
  "TIMEZONE_INVALID",
  "DST_GAP",
  "DST_AMBIGUOUS",
  "INVALID_RANGE",
] as const;
export type AvailabilityReasonCode = (typeof AVAILABILITY_REASONS)[number];
export type Reason = {
  code: AvailabilityReasonCode;
  count: number;
  entityId?: string;
  message?: string;
};

export interface AvailabilityInput {
  branchId: string;
  serviceId: string;
  dateFrom: string;
  dateTo: string;
  staffId?: string;
  slotIntervalMin: 5 | 10 | 15 | 30;
}

export interface Candidate {
  staffId: string;
  displayName: string;
  qualificationScore: number;
}
export interface ResourceSummary {
  resourceTypeId: string;
  required: number;
  available: number;
}
export interface AvailabilitySlot {
  startAt: string;
  endAt: string;
  localStart: string;
  localEnd: string;
  staffCandidates: Candidate[];
  resourceSummary: ResourceSummary[];
  priceReference?: {
    priceId: string;
    amount: string;
    currency: string;
    source: "BRANCH_PRICE" | "TENANT_DEFAULT";
  };
  fingerprint: string;
}
