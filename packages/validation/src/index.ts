import { z } from "zod";
export const authContextSchema = z.object({
  user: z.object({ id: z.string().uuid(), displayName: z.string(), locale: z.enum(["vi-VN", "en-US"]) }),
  workspace: z.object({ tenantId: z.string().uuid(), tenantName: z.string(), tenantSlug: z.string(), membershipId: z.string().uuid(), accessMode: z.string() }),
  authorization: z.object({
    roles: z.array(z.enum(["PLATFORM_SUPER_ADMIN", "SALON_OWNER", "BRANCH_MANAGER", "RECEPTIONIST", "NAIL_TECHNICIAN", "CASHIER", "ACCOUNTANT", "MARKETING", "CUSTOMER"])),
    permissions: z.array(z.string()),
    branchIds: z.array(z.string().uuid()),
    ownStaffId: z.string().uuid().optional(),
  }),
  branches: z.array(z.object({ id: z.string().uuid(), name: z.string(), status: z.string(), timezone: z.string().optional() })),
  capabilities: z.object({ ownerMobileEnabled: z.boolean(), staffMobileEnabled: z.boolean().optional() }).optional(),
  supportAccess: z.object({ grantId: z.string().uuid(), permissions: z.array(z.string()), branchIds: z.array(z.string().uuid()) }).optional(),
});
export const workforceMoneyMinorSchema = z.string().regex(/^\d+$/);
export const timeClockCommandSchema = z
  .object({
    branchId: z.string().uuid(),
    deviceId: z.string().uuid().optional(),
    clientOccurredAt: z.string().datetime({ offset: true }).optional(),
    source: z
      .enum(["STAFF_MOBILE", "OWNER_MOBILE", "ADMIN_WEB", "KIOSK", "API"])
      .optional(),
    locationEvidence: z.record(z.string(), z.unknown()).optional(),
    reasonCode: z.string().trim().max(80).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export const timeClockBreakSchema = z
  .object({
    breakType: z.enum(["PAID_REST", "UNPAID_MEAL", "OTHER"]).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
export const workforceVersionCommandSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2000).optional(),
  })
  .strict();
export const payRateVersionSchema = z
  .object({
    branchId: z.string().uuid().optional().nullable(),
    componentType: z.enum([
      "REGULAR_HOURLY_RATE",
      "OVERTIME_MULTIPLIER",
      "DOUBLE_TIME_MULTIPLIER",
      "SALARY_PERIOD_AMOUNT",
      "FIXED_ALLOWANCE",
      "SERVICE_COMMISSION_OVERRIDE",
      "RETAIL_COMMISSION_OVERRIDE",
    ]),
    amountMinor: workforceMoneyMinorSchema.optional(),
    multiplierNumerator: workforceMoneyMinorSchema.optional(),
    multiplierDenominator: workforceMoneyMinorSchema.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    effectiveFrom: z.string().date(),
    effectiveTo: z.string().date().optional().nullable(),
  })
  .strict();
export const manualPayoutEvidenceSchema = z
  .object({
    externalReference: z.string().trim().min(3).max(200),
    evidence: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
export const uuidSchema = z.string().uuid();
export const analyticsDateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchIds: z.union([uuidSchema, z.array(uuidSchema)]).optional(),
  staffId: uuidSchema.optional(),
  serviceId: uuidSchema.optional(),
  comparisonMode: z.enum(["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR", "CUSTOM_RANGE"]).optional(),
  comparisonFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comparisonTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(["DAY", "WEEK", "MONTH"]).optional(),
  currency: z.string().length(3).optional(),
});
export const netSalesOverviewQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  from: z.string().date(),
  to: z.string().date(),
  comparisonMode: z.enum(["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR", "CUSTOM"]).default("PREVIOUS_PERIOD"),
  comparisonFrom: z.string().date().optional(),
  comparisonTo: z.string().date().optional(),
  staffId: uuidSchema.optional(),
  serviceId: uuidSchema.optional(),
  granularity: z.enum(["DAY", "WEEK", "MONTH"]).default("DAY"),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD_EXTERNAL", "OTHER_EXTERNAL"]).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from > value.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
  const from = Date.parse(`${value.from}T00:00:00Z`);
  const to = Date.parse(`${value.to}T00:00:00Z`);
  if (Number.isFinite(from) && Number.isFinite(to) && (to - from) / 86_400_000 > 365) ctx.addIssue({ code: "custom", path: ["to"], message: "Date range must not exceed 366 days" });
  if (value.comparisonMode === "CUSTOM" && (!value.comparisonFrom || !value.comparisonTo)) ctx.addIssue({ code: "custom", path: ["comparisonFrom"], message: "Custom comparison requires comparisonFrom and comparisonTo" });
  if (value.comparisonFrom && value.comparisonTo && value.comparisonFrom > value.comparisonTo) ctx.addIssue({ code: "custom", path: ["comparisonTo"], message: "comparisonTo must be on or after comparisonFrom" });
});
export const analyticsTargetSchema = z.object({ metricKey: z.string().min(1).max(120), branchId: uuidSchema.optional(), periodStart: z.string(), periodEnd: z.string(), targetValue: z.union([z.string(), z.number()]), currency: z.string().length(3).optional() });
export const analyticsAlertRuleSchema = z.object({ metricKey: z.string().min(1).max(120), branchId: uuidSchema.optional(), operator: z.enum(["LT", "LTE", "GT", "GTE", "EQ"]), threshold: z.union([z.string(), z.number()]), cooldownMinutes: z.number().int().min(0).max(10080).optional() });
export const analyticsExportSchema = z.object({ exportType: z.string().min(1), filters: z.record(z.string(), z.unknown()).optional(), branchIds: z.array(uuidSchema).optional() });
export const tenantContextSchema = z.object({
  tenantId: uuidSchema,
  branchId: uuidSchema.optional(),
  actorUserId: uuidSchema,
});
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const localOperationSchema = z.object({
  operationId: uuidSchema,
  type: z.string().min(1),
  entityId: uuidSchema,
  baseVersion: z.number().int().nonnegative(),
  payload: z.unknown(),
  createdAtDevice: z.string().datetime({ offset: true }),
  syncStatus: z.enum(["PENDING", "SYNCING", "COMPLETED", "FAILED", "CONFLICT"]),
});
export const availabilityQuerySchema = z
  .object({
    branchId: uuidSchema,
    serviceId: uuidSchema,
    dateFrom: z.string().date(),
    dateTo: z.string().date(),
    staffId: uuidSchema.optional(),
    slotIntervalMin: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)])
      .default(15),
  })
  .refine((x) => x.dateTo >= x.dateFrom, {
    message: "dateTo must be on or after dateFrom",
  });
export const availabilityBlockSchema = z
  .object({
    branchId: uuidSchema,
    staffId: uuidSchema.nullable().optional(),
    resourceId: uuidSchema.nullable().optional(),
    blockType: z.enum(["MANUAL", "EXTERNAL", "MAINTENANCE"]),
    title: z.string().trim().min(1).max(200),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    source: z.string().max(100).nullable().optional(),
    sourceReference: z.string().max(255).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((x) => !!x.staffId || !!x.resourceId, {
    message: "staffId or resourceId is required",
  })
  .refine((x) => x.endAt > x.startAt, {
    message: "endAt must be after startAt",
  });
export const staffPreferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ANY") }),
  z.object({ type: z.literal("SPECIFIC"), staffId: uuidSchema }),
]);
export const bookingPlanSchema = z.object({
  branchId: uuidSchema,
  desiredStartAt: z.string().datetime({ offset: true }),
  items: z
    .array(
      z.object({
        serviceId: uuidSchema,
        staffPreference: staffPreferenceSchema,
        availabilityFingerprint: z.string().length(64).optional(),
      }),
    )
    .min(1)
    .max(5),
});
export const createSlotHoldSchema = bookingPlanSchema.extend({
  availabilityDataVersion: z.number().int().positive().optional(),
  clientKey: z.string().min(8).max(200).optional(),
  source: z
    .enum(["CUSTOMER_WEB", "RECEPTION", "OWNER_MOBILE", "API"])
    .default("RECEPTION"),
});
export const appointmentCustomerSchema = z
  .object({
    customerId: uuidSchema.optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().email().max(254).optional(),
    locale: z.enum(["vi-VN", "en-US"]).default("vi-VN"),
  })
  .refine((x) => !!x.customerId || !!x.displayName, {
    message: "customerId or displayName is required",
  });
export const createAppointmentSchema = z.object({
  holdId: uuidSchema,
  holdToken: z.string().optional(),
  customer: appointmentCustomerSchema,
  contactVerificationToken: z.string().optional(),
  customerNote: z.string().max(2000).optional(),
  internalNote: z.string().max(4000).optional(),
  marketingConsent: z.boolean().default(false),
  acceptedPolicyVersion: z.number().int().positive().optional(),
  confirm: z.boolean().default(true),
});
export const publicAppointmentCustomerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    locale: z.enum(["vi-VN", "en-US"]),
  })
  .strict()
  .refine((value) => Boolean(value.phone || value.email), {
    message: "phone or email is required",
  });
export const publicCustomerNoteSchema = z
  .string()
  .max(2000)
  .refine(
    // This explicit range is the security boundary for public customer notes.
    // eslint-disable-next-line no-control-regex
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    "customerNote contains an unsafe control character",
  )
  .transform((value) => value.replace(/\r\n?/g, "\n").trim());
export const publicCreateAppointmentSchema = z
  .object({
    holdId: uuidSchema,
    holdToken: z.string().min(1),
    customer: publicAppointmentCustomerSchema,
    contactVerificationToken: z.string().min(1),
    customerNote: publicCustomerNoteSchema.optional(),
    marketingConsent: z.boolean(),
    acceptedPolicyVersion: z.number().int().positive(),
    acceptedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const customerDirectoryCursorSchema = z
  .object({
    displayNameSortKey: z.string().trim().min(1).max(200),
    customerId: uuidSchema,
  })
  .strict();
export const customerDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export const customerIdParamSchema = z.object({ customerId: uuidSchema }).strict();
export const customerUpdateSchema = z
  .object({
    version: z.number().int().positive().safe(),
    displayName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(32).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    preferredLocale: z.enum(["vi-VN", "en-US"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.phone !== undefined ||
      value.email !== undefined ||
      value.preferredLocale !== undefined,
    { message: "At least one customer field must be provided" },
  );
export const bookingCustomerSearchSchema = customerDirectoryQuerySchema;
export const bookingCustomerCreateSchema = publicAppointmentCustomerSchema;
export const appointmentVersionSchema = z.object({
  version: z.number().int().positive(),
});
export const appointmentCancelSchema = appointmentVersionSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional(),
  actorType: z.enum(["USER", "CUSTOMER"]).default("USER"),
  sendCancellationEmail: z.boolean().default(true),
  policyOverrideReason: z.string().max(1000).optional(),
});
export const appointmentRescheduleSchema = appointmentVersionSchema.extend({
  replacementHoldId: uuidSchema,
  replacementHoldToken: z.string().optional(),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional(),
  actorType: z.enum(["USER", "CUSTOMER"]).default("USER"),
});
export const depositWaiverSchema = appointmentVersionSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});

const optionalNote = z.string().trim().max(2000).optional();
export const walkInCreateSchema = z.object({
  branchId: uuidSchema,
  customerId: uuidSchema.optional(),
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().email().max(254).optional(),
  source: z.enum(["RECEPTION", "KIOSK", "QR", "MOBILE"]).default("RECEPTION"),
  note: optionalNote,
  items: z
    .array(
      z.object({
        serviceId: uuidSchema,
        staffPreference: staffPreferenceSchema.default({ type: "ANY" }),
      }),
    )
    .min(1)
    .max(5),
});
export const versionedCommandSchema = z.object({
  version: z.number().int().positive(),
});
export const walkInStatusCommandSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().max(80).optional(),
  note: optionalNote,
});
export const walkInUpdateSchema = versionedCommandSchema.extend({
  displayName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});
export const walkInPrioritySchema = versionedCommandSchema.extend({
  priority: z.enum(["NORMAL", "RECOVERY", "MANAGER_OVERRIDE"]),
  reason: z.string().trim().min(3).max(1000),
});
export const walkInConversionPlanSchema = z.object({
  desiredStartAt: z.string().datetime({ offset: true }).optional(),
});
export const walkInConversionHoldSchema = walkInConversionPlanSchema.extend({
  availabilityDataVersion: z.number().int().positive().optional(),
});
export const walkInConvertSchema = versionedCommandSchema.extend({
  holdId: uuidSchema,
  customerId: uuidSchema.optional(),
});
export const appointmentArrivalSchema = z.object({
  arrivalMethod: z
    .enum(["RECEPTION", "QR", "KIOSK", "MOBILE"])
    .default("RECEPTION"),
  partySize: z.number().int().min(1).max(50).default(1),
  note: optionalNote,
});
export const appointmentCheckInSchema = z.object({
  version: z.number().int().positive(),
  overrideReason: z.string().trim().min(3).max(1000).optional(),
});
export const appointmentRevertCheckInSchema = appointmentCheckInSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});
export const sessionStartSchema = versionedCommandSchema.extend({
  staffId: uuidSchema,
  overrideReason: z.string().trim().max(1000).optional().nullable(),
});
export const sessionPauseSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const sessionResumeSchema = versionedCommandSchema.extend({
  staffId: uuidSchema,
});
export const sessionCompleteSchema = versionedCommandSchema.extend({
  completionNote: optionalNote,
});
export const sessionCancelSchema = versionedCommandSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const sessionTransferSchema = versionedCommandSchema.extend({
  targetStaffId: uuidSchema,
  reasonCode: z.string().trim().min(1).max(80),
  note: optionalNote,
});
export const serviceSessionChecklistUpdateSchema = versionedCommandSchema.extend({
  completed: z.boolean(),
});
export const serviceSessionNoteSchema = z.object({
  visibility: z.enum(["INTERNAL", "TECHNICIAN"]).default("TECHNICIAN"),
  note: z.string().trim().min(1).max(4000),
});
export const serviceSessionNoteUpdateSchema = serviceSessionNoteSchema.extend({
  version: z.number().int().positive(),
});
export const mediaPresignSchema = z.object({
  mediaType: z.enum(["BEFORE", "AFTER", "REFERENCE"]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024),
  checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const mediaCompleteSchema = z.object({
  checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export const addServicePlanSchema = z.object({
  serviceId: uuidSchema,
  parentItemId: uuidSchema.nullable().optional(),
  staffPreference: staffPreferenceSchema.default({ type: "ANY" }),
});
export const addServiceCommitSchema = z.object({
  holdId: uuidSchema,
  version: z.number().int().positive(),
  parentItemId: uuidSchema.nullable().optional(),
  customerApprovalMethod: z.enum(["VERBAL", "DIGITAL", "WRITTEN"]),
  approvalNote: optionalNote,
});

const moneyMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMoneyMinorSchema = moneyMinorSchema.positive();

export const posOrderCreateSchema = z
  .object({
    registerId: uuidSchema.optional(),
  })
  .strict();
const posOrderStatusSchema = z.enum([
  "DRAFT",
  "READY_FOR_PAYMENT",
  "PARTIALLY_PAID",
  "PAID",
  "VOIDED",
  "EXPIRED",
]);
const posOrderSourceSchema = z.enum([
  "APPOINTMENT",
  "WALK_IN",
  "COUNTER_SALE",
  "MANUAL",
]);
const posTenderTypeSchema = z.enum([
  "CASH",
  "CARD_EXTERNAL",
  "BANK_TRANSFER",
  "OTHER_EXTERNAL",
]);
export const cashSessionDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    registerId: uuidSchema.optional(),
    cashierUserId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    status: z.enum(["OPEN", "CLOSING", "CLOSED"]).optional(),
    reconciliation: z.enum(["ALL", "MATCHED", "VARIANCE"]).default("ALL"),
    varianceDirection: z.enum(["SHORT", "OVER"]).optional(),
    businessDateFrom: z.string().date().optional(),
    businessDateTo: z.string().date().optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "REVENUE_DESC", "REVENUE_ASC", "VARIANCE_DESC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50, 100].includes(value), {
        message: "pageSize must be one of 10, 20, 50, 100",
      })
      .default(10),
  })
  .strict()
  .refine(
    (value) =>
      !value.businessDateFrom ||
      !value.businessDateTo ||
      value.businessDateFrom <= value.businessDateTo,
    {
      message: "businessDateTo must be on or after businessDateFrom",
      path: ["businessDateTo"],
    },
  );
export const posOrderDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    status: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.includes(",")
            ? value.split(",").map((part) => part.trim())
            : value,
        z.union([posOrderStatusSchema, z.array(posOrderStatusSchema).min(1).max(6)]),
      )
      .optional(),
    source: posOrderSourceSchema.optional(),
    tenderType: posTenderTypeSchema.optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce.number()
      .int()
      .refine((value) => [10, 20, 50, 100].includes(value), {
        message: "pageSize must be one of 10, 20, 50, 100",
      })
      .default(10),
    refundFilter: z.enum(["NONE", "HAS_REFUND", "NO_REFUND"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    {
      message: "dateTo must be on or after dateFrom",
      path: ["dateTo"],
    },
  );
export const invoiceDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    invoiceStatus: z
      .enum(["DRAFT", "ISSUED", "VOIDED_BEFORE_PAYMENT"])
      .optional(),
    paymentState: z.enum(["PAID", "PARTIAL", "OUTSTANDING"]).optional(),
    correction: z.enum(["NONE", "REFUND", "CREDIT_NOTE", "ANY"]).optional(),
    customerId: uuidSchema.optional(),
    source: z.enum(["APPOINTMENT_POS", "OTHER_POS"]).optional(),
    issuedFrom: z.string().date().optional(),
    issuedTo: z.string().date().optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "TOTAL_DESC", "TOTAL_ASC", "OUTSTANDING_DESC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50, 100].includes(value), {
        message: "pageSize must be one of 10, 20, 50, 100",
      })
      .default(10),
  })
  .strict()
  .refine(
    (value) =>
      !value.issuedFrom || !value.issuedTo || value.issuedFrom <= value.issuedTo,
    {
      message: "issuedTo must be on or after issuedFrom",
      path: ["issuedTo"],
    },
  );
const paymentStatusSchema = z.enum([
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
  "REVERSED_TECHNICAL",
]);
export const paymentDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    tenderType: z
      .enum(["CASH", "CARD_EXTERNAL", "BANK_TRANSFER", "OTHER_EXTERNAL"])
      .optional(),
    status: paymentStatusSchema.optional(),
    reconciliation: z.enum(["ALL", "NEEDS_ATTENTION", "NORMAL"]).default("ALL"),
    refund: z.enum(["ANY", "HAS_REFUND", "NO_REFUND"]).default("ANY"),
    orderId: uuidSchema.optional(),
    invoiceId: uuidSchema.optional(),
    cashSessionId: uuidSchema.optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    sort: z.enum(["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"]).default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50, 100].includes(value), {
        message: "pageSize must be one of 10, 20, 50, 100",
      })
      .default(10),
  })
  .strict()
  .refine(
    (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    {
      message: "dateTo must be on or after dateFrom",
      path: ["dateTo"],
    },
  );
export const posOrderVersionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const posAssignRegisterSchema = posOrderVersionSchema
  .extend({ registerId: uuidSchema })
  .strict();
export const posManualLineSchema = posOrderVersionSchema
  .extend({
    lineType: z.enum(["MANUAL_SERVICE", "ADJUSTMENT"]),
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(1000).default(1),
    unitPriceMinor: moneyMinorSchema,
    reasonCode: z.string().trim().min(1).max(80),
  })
  .strict();
export const posDiscountSchema = posOrderVersionSchema
  .extend({
    orderLineId: uuidSchema.optional(),
    discountType: z.enum(["FIXED", "PERCENT"]),
    value: z.number().nonnegative().max(10000),
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const posDiscountDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    decisionReason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const posTipSchema = posOrderVersionSchema
  .extend({
    amountMinor: moneyMinorSchema,
    source: z
      .enum(["CUSTOMER", "CASHIER_ENTRY", "TERMINAL"])
      .default("CASHIER_ENTRY"),
    allocationBasis: z.enum(["MANUAL", "EQUAL", "WORK_SECONDS"]),
    allocations: z
      .array(
        z
          .object({
            staffId: uuidSchema,
            appointmentItemId: uuidSchema.optional(),
            amountMinor: moneyMinorSchema,
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
export const posVoidSchema = posOrderVersionSchema
  .extend({ reason: z.string().trim().min(3).max(1000) })
  .strict();

const paymentBase = {
  version: z.number().int().positive(),
  amountToApplyMinor: positiveMoneyMinorSchema,
};
export const cashPaymentSchema = z
  .object({
    ...paymentBase,
    tenderType: z.literal("CASH"),
    cashReceivedMinor: positiveMoneyMinorSchema,
    cashSessionId: uuidSchema,
  })
  .strict();
export const cardExternalPaymentSchema = z
  .object({
    ...paymentBase,
    tenderType: z.literal("CARD_EXTERNAL"),
    provider: z.string().trim().min(1).max(100),
    providerTransactionId: z.string().trim().min(1).max(200),
    terminalId: z.string().trim().max(120).optional(),
    cardBrand: z.string().trim().max(40).optional(),
    cardLast4: z
      .string()
      .regex(/^[0-9]{4}$/)
      .optional(),
    approvalCode: z.string().trim().max(80).optional(),
  })
  .strict();
export const bankTransferPaymentSchema = z
  .object({
    ...paymentBase,
    tenderType: z.literal("BANK_TRANSFER"),
    providerTransactionId: z.string().trim().min(1).max(200),
    receivedAt: z.string().datetime({ offset: true }),
    evidenceNote: z.string().trim().min(1).max(1000),
  })
  .strict();
export const otherExternalPaymentSchema = z
  .object({
    ...paymentBase,
    tenderType: z.literal("OTHER_EXTERNAL"),
    provider: z.string().trim().min(1).max(100),
    providerTransactionId: z.string().trim().min(1).max(200),
    evidenceNote: z.string().trim().min(1).max(1000),
  })
  .strict();
export const posPaymentSchema = z.discriminatedUnion("tenderType", [
  cashPaymentSchema,
  cardExternalPaymentSchema,
  bankTransferPaymentSchema,
  otherExternalPaymentSchema,
]);

export const cashSessionOpenSchema = z
  .object({
    registerId: uuidSchema,
    cashDrawerId: uuidSchema,
    openingFloatMinor: moneyMinorSchema,
    deviceId: z.string().trim().max(200).optional(),
  })
  .strict();
export const cashMovementSchema = z
  .object({
    version: z.number().int().positive(),
    movementType: z.enum(["CASH_IN", "CASH_OUT", "CASH_DROP"]),
    amountMinor: positiveMoneyMinorSchema,
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const cashSessionVersionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const cashDeclareSchema = cashSessionVersionSchema
  .extend({
    declaredCashMinor: moneyMinorSchema,
    denominations: z
      .array(
        z
          .object({
            denominationMinor: positiveMoneyMinorSchema,
            count: z.number().int().nonnegative().max(100000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export const cashCloseSchema = cashSessionVersionSchema
  .extend({
    varianceReason: z.string().trim().min(3).max(1000).optional(),
    approveVariance: z.boolean().default(false),
  })
  .strict();
export const invoiceDeliverySchema = z
  .object({
    channel: z.enum(["EMAIL", "SMS_LINK", "PRINT"]),
    destination: z.string().trim().max(254).optional(),
  })
  .strict();

const refundLineSchema = z
  .object({ invoiceLineId: uuidSchema, amountMinor: positiveMoneyMinorSchema })
  .strict();
const refundPaymentPreferenceSchema = z
  .object({ paymentId: uuidSchema, amountMinor: positiveMoneyMinorSchema })
  .strict();
export const refundPlanSchema = z
  .object({
    items: z.array(refundLineSchema).min(1).max(100),
    tipAmountMinor: moneyMinorSchema.default(0),
    refundDestination: z
      .enum(["ORIGINAL_TENDER", "CUSTOMER_CREDIT"])
      .default("ORIGINAL_TENDER"),
    paymentPreferences: z
      .array(refundPaymentPreferenceSchema)
      .max(20)
      .optional(),
    overrideReason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const refundCreateSchema = refundPlanSchema
  .extend({
    reasonCode: z.string().trim().min(1).max(80),
    reasonText: z.string().trim().min(3).max(2000),
  })
  .strict();
export const refundDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(120).optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "UNKNOWN",
        "REJECTED",
        "CANCELLED",
      ])
      .optional(),
    refundKind: z.enum(["FULL", "PARTIAL", "TIP_ONLY", "MIXED"]).optional(),
    tenderType: z
      .enum(["CASH", "CARD_EXTERNAL", "BANK_TRANSFER", "OTHER_EXTERNAL"])
      .optional(),
    requestedFrom: z.string().date().optional(),
    requestedTo: z.string().date().optional(),
    customerId: uuidSchema.optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();
export const creditNoteDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    status: z.enum(["DRAFT", "ISSUED"]).optional(),
    refundKind: z.enum(["FULL", "PARTIAL", "TIP_ONLY", "MIXED"]).optional(),
    issuedFrom: z.string().date().optional(),
    issuedTo: z.string().date().optional(),
    sort: z.enum(["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"]).default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50, 100].includes(value), {
        message: "pageSize must be one of 10, 20, 50, 100",
      })
      .default(10),
  })
  .strict()
  .refine(
    (value) =>
      !value.issuedFrom || !value.issuedTo || value.issuedFrom <= value.issuedTo,
    {
      message: "issuedTo must be on or after issuedFrom",
      path: ["issuedTo"],
    },
  );
export const refundVersionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const refundDecisionSchema = refundVersionSchema
  .extend({ reason: z.string().trim().min(3).max(1000) })
  .strict();
export const cashRefundExecutionSchema = refundVersionSchema
  .extend({ cashSessionId: uuidSchema })
  .strict();
export const externalRefundExecutionSchema = refundVersionSchema
  .extend({
    provider: z.string().trim().min(1).max(100),
    providerRefundId: z.string().trim().min(1).max(200),
    processedAt: z.string().datetime({ offset: true }),
    evidenceNote: z.string().trim().min(3).max(1000),
  })
  .strict();
export const creditNoteDeliverySchema = z
  .object({
    channel: z.enum(["EMAIL", "SMS_LINK", "PRINT"]),
    destination: z.string().trim().max(254).optional(),
  })
  .strict();
export const commissionRuleSchema = z
  .object({
    branchId: uuidSchema.optional().nullable(),
    staffId: uuidSchema.optional().nullable(),
    serviceId: uuidSchema.optional().nullable(),
    ruleCode: z.string().trim().min(1).max(80),
    ruleType: z.enum(["SERVICE_PERCENT", "SERVICE_FIXED"]),
    baseMode: z.enum([
      "NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX",
      "GROSS_SERVICE_BEFORE_DISCOUNT",
      "FIXED_PER_COMPLETED_SERVICE",
    ]),
    percentBasisPoints: z.number().int().min(0).max(10000).optional(),
    fixedMinor: moneyMinorSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    priority: z.number().int().min(-100000).max(100000).default(0),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional().nullable(),
    policy: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ruleType === "SERVICE_PERCENT" &&
      value.percentBasisPoints === undefined
    )
      context.addIssue({
        code: "custom",
        path: ["percentBasisPoints"],
        message: "Required for percentage rule",
      });
    if (value.ruleType === "SERVICE_FIXED" && value.fixedMinor === undefined)
      context.addIssue({
        code: "custom",
        path: ["fixedMinor"],
        message: "Required for fixed rule",
      });
  });
export const commissionPeriodSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    startDate: z.string().date(),
    endDate: z.string().date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const commissionPeriodCommandSchema = refundVersionSchema.extend({
  reason: z.string().trim().min(3).max(1000).optional(),
});
export const commissionAdjustmentSchema = z
  .object({
    staffId: uuidSchema,
    targetPeriodId: uuidSchema,
    postingPeriodId: uuidSchema.optional().nullable(),
    amountMinor: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const commissionPeriodOverviewQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
  })
  .strict();
export const commissionStaffDirectoryQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    search: z.string().trim().max(120).optional(),
    staffId: uuidSchema.optional(),
    adjustment: z
      .enum(["ALL", "WITH_ADJUSTMENT", "WITHOUT_ADJUSTMENT"])
      .default("ALL"),
    sort: z
      .enum(["REVENUE_DESC", "COMMISSION_DESC", "TIP_DESC", "NAME_ASC"])
      .default("REVENUE_DESC"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), {
        message: "pageSize must be one of 10, 20, 50",
      })
      .default(10),
  })
  .strict();
export const financialExportSchema = z
  .object({
    branchId: uuidSchema.optional(),
    exportType: z.enum([
      "REFUNDS",
      "CREDIT_NOTES",
      "COMMISSION_ENTRIES",
      "COMMISSION_STATEMENTS",
      "NET_SALES",
      "PAYMENT_RECONCILIATION",
    ]),
    filters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const paymentReconciliationQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    businessDate: z.string().date().optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    search: z.string().trim().max(120).optional(),
    tenderType: z.enum(["CASH", "CARD_EXTERNAL", "BANK_TRANSFER", "OTHER_EXTERNAL"]).optional(),
    caseType: z.enum(["MATCH", "AMOUNT_MISMATCH", "MISSING_INVOICE", "MISSING_CASH_MOVEMENT", "MISSING_CASH_SESSION", "PROVIDER_UNRESOLVED", "PROVIDER_EVIDENCE_MISMATCH", "DUPLICATE_REFERENCE", "PARTIAL_OUTSTANDING"]).optional(),
    reviewState: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "ESCALATED"]).optional(),
    attentionOnly: z.coerce.boolean().default(false),
    sort: z.enum(["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"]).default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: "dateFrom must be before or equal to dateTo",
    path: ["dateFrom"],
  });

export const paymentReconciliationNoteSchema = z
  .object({ version: z.number().int().positive(), note: z.string().trim().min(3).max(2000) })
  .strict();

export const paymentReconciliationDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(["CONFIRM_MATCH", "ACCEPT_VARIANCE", "KEEP_REVIEW", "ESCALATE"]),
    reasonCode: z.string().trim().min(2).max(80).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const paymentReconciliationBulkConfirmSchema = z
  .object({ versionByPaymentId: z.record(uuidSchema, z.number().int().positive()).refine((value) => Object.keys(value).length > 0, "At least one payment is required") })
  .strict();

export const voucherCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    discountType: z.enum(["FIXED", "PERCENT"]),
    discountValue: z.number().int().positive().safe(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    minimumSpendMinor: moneyMinorSchema.default(0),
    maximumDiscountMinor: positiveMoneyMinorSchema.optional(),
    totalUseLimit: z.number().int().positive().safe().optional(),
    perCustomerUseLimit: z.number().int().positive().max(100000).optional(),
    codeUseLimit: z.number().int().positive().max(100000).default(1),
    branchIds: z.array(uuidSchema).max(100).default([]),
    serviceIds: z.array(uuidSchema).max(1000).default([]),
    customerIds: z.array(uuidSchema).max(10000).default([]),
    membershipTierIds: z.array(uuidSchema).max(100).default([]),
    eligibilityPolicy: z.record(z.string(), z.unknown()).default({}),
    refundPolicy: z
      .enum(["RESTORE_USE", "DO_NOT_RESTORE", "PROPORTIONAL_RESTORE"])
      .default("DO_NOT_RESTORE"),
    validFrom: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.validUntil <= value.validFrom)
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Must be after validFrom",
      });
    if (value.discountType === "PERCENT" && value.discountValue > 10000)
      context.addIssue({
        code: "custom",
        path: ["discountValue"],
        message: "Basis points cannot exceed 10000",
      });
    if (value.discountType === "FIXED" && !value.currency)
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Currency is required",
      });
  });
export const voucherCodeIssueSchema = z
  .object({
    code: z.string().trim().min(4).max(100),
    customerId: uuidSchema.optional().nullable(),
    useLimit: z.number().int().positive().max(100000).default(1),
    expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .strict();
export const voucherBatchSchema = z
  .object({ codes: z.array(voucherCodeIssueSchema).min(1).max(1000) })
  .strict();
export const voucherAssignSchema = z
  .object({ customerId: uuidSchema, version: z.number().int().positive() })
  .strict();
export const voucherValidateSchema = z
  .object({
    code: z.string().trim().min(4).max(100),
    branchId: uuidSchema,
    customerId: uuidSchema,
    serviceItems: z
      .array(
        z
          .object({ serviceId: uuidSchema, amountMinor: moneyMinorSchema })
          .strict(),
      )
      .min(1)
      .max(100),
    localDateTime: z.string().datetime({ offset: true }),
  })
  .strict();
export const voucherDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    assignmentScope: z
      .enum(["CUSTOMER_ASSIGNED", "GENERAL", "ALL"])
      .default("CUSTOMER_ASSIGNED"),
    customerId: uuidSchema.optional(),
    campaignId: uuidSchema.optional(),
    discountType: z.enum(["PERCENT", "FIXED"]).optional(),
    lifecycleState: z
      .enum(["ALL", "USABLE", "PARTIALLY_USED", "USED", "EXPIRING", "EXPIRED", "CANCELLED"])
      .default("ALL"),
    branchId: uuidSchema.optional(),
    membershipTierId: uuidSchema.optional(),
    expiryWindowDays: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value), "Unsupported expiry window")
      .default(30),
    unusedOlderThanDays: z.coerce.number().int().min(1).max(3650).optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "EXPIRY_ASC", "USED_DESC", "CUSTOMER_NAME"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
  })
  .strict();
export const voucherEligibilityPreviewSchema = z
  .object({
    customerId: uuidSchema,
    branchId: uuidSchema,
    localDateTime: z.string().datetime({ offset: true }),
    serviceItems: z
      .array(
        z
          .object({ serviceId: uuidSchema, amountMinor: moneyMinorSchema })
          .strict(),
      )
      .min(1)
      .max(100),
    currency: z.string().trim().length(3).toUpperCase().optional(),
  })
  .strict();
export const benefitOrderCommandSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const voucherApplySchema = benefitOrderCommandSchema
  .extend({ code: z.string().trim().min(4).max(100) })
  .strict();
export const loyaltyApplySchema = benefitOrderCommandSchema
  .extend({ points: z.number().int().positive().safe() })
  .strict();
export const membershipApplySchema = benefitOrderCommandSchema
  .extend({ assignmentId: uuidSchema.optional() })
  .strict();
export const packageApplySchema = benefitOrderCommandSchema
  .extend({
    entitlementId: uuidSchema,
    orderLineId: uuidSchema,
    units: z.number().int().positive().default(1),
  })
  .strict();

export const loyaltyProgramSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    earnBasis: z
      .enum([
        "NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP",
        "NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX",
        "FIXED_PER_COMPLETED_SERVICE",
      ])
      .default("NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP"),
    spendMinorPerPoint: z.number().int().positive().safe(),
    redemptionPoints: z.number().int().positive().safe(),
    redemptionMinor: z.number().int().positive().safe(),
    settlementDelayHours: z.number().int().min(0).max(8760).default(0),
    pointsValidDays: z
      .number()
      .int()
      .positive()
      .max(36500)
      .optional()
      .nullable(),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional().nullable(),
    policy: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const loyaltyAdjustmentSchema = z
  .object({
    customerId: uuidSchema,
    pointsDelta: z
      .number()
      .int()
      .safe()
      .refine((v) => v !== 0),
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const benefitDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const membershipTierSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.record(z.string(), z.string().trim().min(1)),
    qualificationType: z.enum([
      "MANUAL",
      "ROLLING_SPEND",
      "LIFETIME_SPEND",
      "VISIT_COUNT",
      "POINTS_EARNED",
    ]),
    qualificationThreshold: z.number().int().nonnegative().safe(),
    rollingWindowDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional()
      .nullable(),
    benefits: z
      .array(
        z
          .object({
            type: z.enum([
              "PERCENT_DISCOUNT",
              "FIXED_DISCOUNT",
              "LOYALTY_MULTIPLIER",
              "PRIORITY_BOOKING",
              "BOOKING_WINDOW_EXTENSION",
              "PACKAGE_BONUS",
            ]),
            value: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .max(50),
    priority: z.number().int().min(-100000).max(100000).default(0),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .strict();
export const membershipAssignSchema = z
  .object({
    tierId: uuidSchema,
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).optional().nullable(),
    reasonCode: z.string().trim().min(1).max(80).default("MANUAL"),
  })
  .strict();

export const servicePackageSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.record(z.string(), z.string().trim().min(1)),
    description: z.record(z.string(), z.string()).default({}),
    grantedUnits: z.number().int().positive().max(100000),
    unitsPerRedemption: z.number().int().positive().max(100000).default(1),
    priceMinor: moneyMinorSchema.default(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    validityDays: z.number().int().positive().max(36500),
    refundPolicy: z
      .enum(["RESTORE_UNIT", "DO_NOT_RESTORE", "MANUAL_REVIEW"])
      .default("RESTORE_UNIT"),
    policy: z.record(z.string(), z.unknown()).default({}),
    eligibility: z
      .array(
        z
          .object({
            serviceId: uuidSchema.optional(),
            categoryId: uuidSchema.optional(),
            branchId: uuidSchema.optional(),
            unitsPerRedemption: z.number().int().positive().default(1),
          })
          .refine((v) => !!v.serviceId || !!v.categoryId),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export const packageIssueSchema = z
  .object({
    packageProductId: uuidSchema,
    expiresAt: z.string().datetime({ offset: true }).optional(),
    generationKey: z.string().trim().min(8).max(200).optional(),
  })
  .strict();
export const packageAdjustmentSchema = z
  .object({
    unitsDelta: z
      .number()
      .int()
      .refine((v) => v !== 0),
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const packageReservationSchema = z
  .object({
    branchId: uuidSchema,
    appointmentId: uuidSchema.optional(),
    appointmentItemId: uuidSchema.optional(),
    posOrderId: uuidSchema.optional(),
    serviceId: uuidSchema,
    units: z.number().int().positive().default(1),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const appointmentPackageReservationSchema = z
  .object({
    entitlementId: uuidSchema,
    appointmentItemId: uuidSchema,
    version: z.number().int().positive(),
  })
  .strict();
export const publicPackageReservationSchema = z
  .object({ entitlementId: uuidSchema, appointmentItemId: uuidSchema })
  .strict();
export const benefitExportSchema = z
  .object({
    exportType: z.enum([
      "VOUCHERS",
      "LOYALTY",
      "MEMBERSHIP",
      "PACKAGES",
      "LIABILITY",
      "EXPIRING",
      "CUSTOMER_DIRECTORY",
    ]),
    filters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const benefitCustomerDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    category: z
      .enum([
        "ALL",
        "LOYALTY",
        "MEMBERSHIP",
        "PACKAGE",
        "VOUCHER",
        "GIFT_CARD",
        "CUSTOMER_CREDIT",
      ])
      .default("ALL"),
    state: z
      .enum(["ALL", "AVAILABLE", "EXPIRING", "NO_ACTIVE_BENEFITS"])
      .default("ALL"),
    membershipTierId: z.string().uuid().optional(),
    expiryWindowDays: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value))
      .default(30),
    hasBalance: z.preprocess(
      (value) => {
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value === "boolean") return value;
        return String(value).toLowerCase() === "true";
      },
      z.boolean().optional(),
    ),
    sort: z
      .enum(["CUSTOMER_NAME", "BENEFIT_VALUE_DESC", "EXPIRY_ASC", "LOYALTY_DESC"])
      .default("CUSTOMER_NAME"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value))
      .default(10),
  })
  .strict();

export const loyaltyLedgerDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    group: z
      .enum([
        "ALL",
        "EARN",
        "REDEEM",
        "REFUND",
        "MANUAL_ADJUSTMENT",
        "EXPIRE",
        "PENDING",
        "RESERVATION",
      ])
      .default("ALL"),
    sign: z.enum(["ALL", "POSITIVE", "NEGATIVE"]).default("ALL"),
    source: z
      .enum(["ALL", "POS", "INVOICE", "REFUND", "MANUAL", "SYSTEM"])
      .default("ALL"),
    displayStatus: z
      .enum(["ALL", "PENDING", "RECORDED", "RELEASED", "EXPIRED"])
      .default("ALL"),
    sort: z.enum(["NEWEST", "OLDEST"]).default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value))
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date must not be before the start date",
      });
    }
  });

export const membershipHubDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    tierId: z.string().uuid().optional(),
    assignmentState: z
      .enum(["ALL", "ACTIVE", "NO_ACTIVE", "EXPIRING"])
      .default("ALL"),
    assignmentSource: z
      .enum(["ALL", "AUTOMATIC", "MANUAL"])
      .default("ALL"),
    expiryWindowDays: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value))
      .default(30),
    progressBucket: z
      .enum(["ALL", "NEAR_UPGRADE", "IN_PROGRESS", "MANUAL", "MAX_TIER", "NO_CURRENT"])
      .default("ALL"),
    sort: z
      .enum(["CUSTOMER_NAME", "POINTS_DESC", "SPENDING_DESC", "EXPIRY_ASC", "PROGRESS_DESC"])
      .default("CUSTOMER_NAME"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value))
      .default(10),
  })
  .strict();

export const packageDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    packageProductId: uuidSchema.optional(),
    status: z
      .enum(["ALL", "ACTIVE", "EXPIRING", "EXHAUSTED", "EXPIRED", "OVERDUE", "CANCELLED"])
      .default("ALL"),
    remaining: z
      .enum(["ALL", "AVAILABLE", "RESERVED", "ONE_LEFT", "MANY_LEFT", "USED_UP", "EXPIRED_UNUSED"])
      .default("ALL"),
    expiryWindowDays: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value))
      .default(30),
    issuedFrom: z.string().date().optional(),
    issuedTo: z.string().date().optional(),
    sort: z
      .enum(["CUSTOMER_NAME", "EXPIRY_ASC", "REMAINING_DESC", "CONSUMED_DESC", "VALUE_DESC", "ISSUED_DESC"])
      .default("EXPIRY_ASC"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value))
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.issuedFrom && value.issuedTo && value.issuedFrom > value.issuedTo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedTo"],
        message: "The end date must not be before the start date",
      });
    }
  });

export const inventoryQuantitySchema = z
  .string()
  .regex(
    /^\d+(?:\.\d{1,6})?$/,
    "Use a positive decimal string with at most 6 decimals",
  )
  .refine((value) => Number(value) > 0, "Quantity must be positive");
export const inventorySignedQuantitySchema = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,6})?$/)
  .refine((value) => Number(value) !== 0, "Quantity delta cannot be zero");
export const moneyMinorStringSchema = z.string().regex(/^\d+$/);
export const inventoryItemSchema = z
  .object({
    categoryId: uuidSchema.optional().nullable(),
    baseUomId: uuidSchema,
    sku: z.string().trim().min(1).max(80),
    name: z.record(z.string(), z.string().trim().min(1)),
    itemType: z.enum(["CONSUMABLE", "RETAIL", "BOTH"]),
    trackLot: z.boolean().default(false),
    trackExpiry: z.boolean().default(false),
    trackingMode: z.enum(["NONE", "LOT", "LOT_AND_EXPIRY"]).optional(),
    quantityPrecision: z.number().int().min(0).max(6).default(3),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("VND"),
    retailPriceMinor: moneyMinorStringSchema.optional().nullable(),
    barcodes: z.array(z.string().trim().min(3).max(120)).max(20).default([]),
  })
  .strict();
export const inventoryLocationSchema = z
  .object({
    branchId: uuidSchema,
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    locationType: z.enum([
      "STOCKROOM",
      "BACKBAR",
      "SERVICE_FLOOR",
      "RETAIL",
      "RETAIL_FLOOR",
      "QUARANTINE",
      "DAMAGED",
      "IN_TRANSIT",
    ]),
  })
  .strict();
export const inventorySupplierSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(240).optional(),
    contact: z.record(z.string(), z.unknown()).default({}),
    leadTimeDays: z.number().int().nonnegative().default(0),
    paymentTerms: z.string().trim().max(1000).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const inventoryPurchaseOrderSchema = z
  .object({
    branchId: uuidSchema,
    supplierId: uuidSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    expectedAt: z.string().datetime({ offset: true }).optional().nullable(),
    note: z.string().trim().max(2000).optional(),
    lines: z
      .array(
        z
          .object({
            itemId: uuidSchema,
            uomId: uuidSchema,
            quantity: inventoryQuantitySchema,
            unitPriceMinor: moneyMinorStringSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const inventoryReceiptSchema = z
  .object({
    branchId: uuidSchema,
    purchaseOrderId: uuidSchema.optional().nullable(),
    locationId: uuidSchema,
    receivedAt: z.string().datetime({ offset: true }),
    lines: z
      .array(
        z
          .object({
            purchaseOrderLineId: uuidSchema.optional().nullable(),
            itemId: uuidSchema,
            lotId: uuidSchema.optional().nullable(),
            quantity: inventoryQuantitySchema,
            uomId: uuidSchema.optional(),
            baseQuantity: inventoryQuantitySchema.optional(),
            unitCostMinor: moneyMinorStringSchema,
            qualityDisposition: z
              .enum(["ACCEPTED", "QUARANTINE", "REJECTED"])
              .default("ACCEPTED"),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const inventoryVersionCommandSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const inventoryAdjustmentSchema = z
  .object({
    branchId: uuidSchema,
    locationId: uuidSchema,
    itemId: uuidSchema,
    lotId: uuidSchema.optional().nullable(),
    quantityDelta: inventorySignedQuantitySchema,
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
export const inventoryCountSchema = z
  .object({
    branchId: uuidSchema,
    locationId: uuidSchema,
    blind: z.literal(true).default(true),
    items: z
      .array(
        z
          .object({
            itemId: uuidSchema,
            lotId: uuidSchema.optional().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export const inventoryCountLineSchema = z
  .object({
    version: z.number().int().positive(),
    countedQuantity: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  })
  .strict();
export const inventoryTransferSchema = z
  .object({
    sourceBranchId: uuidSchema,
    destinationBranchId: uuidSchema,
    sourceLocationId: uuidSchema,
    destinationLocationId: uuidSchema,
    lines: z
      .array(
        z
          .object({
            itemId: uuidSchema,
            lotId: uuidSchema.optional().nullable(),
            quantity: inventoryQuantitySchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const serviceMaterialRecipeSchema = z
  .object({
    serviceId: uuidSchema,
    branchId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(1).max(160),
    lines: z
      .array(
        z
          .object({
            itemId: uuidSchema,
            uomId: uuidSchema,
            quantity: inventoryQuantitySchema,
            wastageBasisPoints: z.number().int().min(0).max(10000).default(0),
            sourceLocationId: uuidSchema.optional().nullable(),
            selectionMethod: z.enum(["FEFO", "FIFO", "MANUAL"]).default("FEFO"),
            required: z.boolean().default(true),
            allowOverride: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const inventoryConsumeSchema = z
  .object({
    version: z.number().int().positive(),
    actualLines: z
      .array(
        z
          .object({
            reservationLineId: uuidSchema,
            quantity: inventoryQuantitySchema,
            overrideReason: z.string().trim().min(3).max(1000).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const retailReturnDecisionSchema = z
  .object({
    refundItemId: uuidSchema,
    inventoryItemId: uuidSchema,
    disposition: z.enum([
      "RESTOCK",
      "DAMAGED",
      "QUARANTINE",
      "DISCARD",
      "NO_RETURN",
    ]),
    locationId: uuidSchema.optional().nullable(),
    lotId: uuidSchema.optional().nullable(),
    quantity: inventoryQuantitySchema,
    reasonCode: z.string().trim().min(1).max(80),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const giftCardProductSchema = z
  .object({
    productCode: z.string().trim().min(2).max(80),
    name: z.record(z.string(), z.string().trim().min(1)),
    amountMode: z.enum(["FIXED", "OPEN"]),
    cardForm: z.enum(["PHYSICAL", "DIGITAL", "BOTH"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    minimumAmountMinor: moneyMinorStringSchema,
    maximumAmountMinor: moneyMinorStringSchema,
    fixedDenominationsMinor: z
      .array(moneyMinorStringSchema)
      .max(50)
      .default([]),
    maximumBalanceMinor: moneyMinorStringSchema,
    reloadable: z.boolean().default(false),
    assignmentPolicy: z
      .enum(["BEARER", "CUSTOMER_REQUIRED", "BEARER_OR_CUSTOMER"])
      .default("BEARER_OR_CUSTOMER"),
    pinRequired: z.boolean().default(true),
    legalPolicyId: uuidSchema.optional().nullable(),
    branchScope: z.record(z.string(), z.unknown()).default({}),
    eligibilityPolicy: z.record(z.string(), z.unknown()).default({}),
    refundPolicy: z.record(z.string(), z.unknown()).default({}),
    replacementPolicy: z.record(z.string(), z.unknown()).default({}),
    limitsPolicy: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const giftCardLineSchema = z
  .object({
    productId: uuidSchema,
    amountMinor: moneyMinorStringSchema,
    customerId: uuidSchema.optional().nullable(),
    form: z.enum(["PHYSICAL", "DIGITAL"]),
    deliveryChannel: z.enum(["EMAIL", "SMS", "PRINT", "NONE"]).default("NONE"),
    deviceId: z.string().trim().min(1).max(200).optional(),
    approvalReason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const giftCardReloadLineSchema = z
  .object({
    giftCardId: uuidSchema,
    amountMinor: moneyMinorStringSchema,
    version: z.number().int().positive(),
    deviceId: z.string().trim().min(1).max(200).optional(),
    approvalReason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const storedValueLookupSchema = z
  .object({
    number: z.string().trim().min(12).max(64),
    pin: z.string().trim().min(4).max(12).optional(),
  })
  .strict();
export const storedValueReserveSchema = z
  .object({
    requestedMinor: moneyMinorStringSchema,
    number: z.string().trim().min(12).max(64).optional(),
    pin: z.string().trim().min(4).max(12).optional(),
    version: z.number().int().positive(),
    deviceId: z.string().trim().min(1).max(200).optional(),
    approvalReason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const storedValueVersionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const giftCardDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    branchId: uuidSchema.optional(),
    productId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    ownership: z
      .enum(["ALL", "CUSTOMER_ASSIGNED", "BEARER"])
      .default("ALL"),
    lifecycle: z
      .enum([
        "ALL",
        "PENDING_ACTIVATION",
        "ACTIVE",
        "SUSPENDED",
        "DEPLETED",
        "EXPIRED",
        "CANCELLED",
        "REPLACED",
      ])
      .default("ALL"),
    derivedState: z
      .enum(["ALL", "UNUSED", "PARTIALLY_USED", "EXPIRING", "DORMANT_WITH_BALANCE"])
      .default("ALL"),
    balanceBucket: z
      .enum(["ALL", "GT_1000000", "500K_TO_1M", "100K_TO_499K", "LT_100K", "ZERO"])
      .default("ALL"),
    issuedFrom: z.string().date().optional(),
    issuedTo: z.string().date().optional(),
    expiryWindowDays: z.coerce
      .number()
      .int()
      .refine((value) => [7, 30, 90].includes(value), "Unsupported expiry window")
      .default(30),
    inactiveDays: z.coerce.number().int().min(1).max(3650).default(90),
    sort: z
      .enum(["NEWEST", "OLDEST", "BALANCE_DESC", "BALANCE_ASC", "EXPIRY_ASC", "LAST_ACTIVITY_ASC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.issuedFrom && value.issuedTo && value.issuedFrom > value.issuedTo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issuedTo"],
        message: "The end date must not be before the start date",
      });
    }
  });
export const giftCardLedgerDirectoryQuerySchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    entryType: z.string().trim().max(80).optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
    sort: z.enum(["NEWEST", "OLDEST"]).default("NEWEST"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date must not be before the start date",
      });
    }
  });
export const customerCreditAdjustmentSchema = z
  .object({
    branchId: uuidSchema,
    customerId: uuidSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    adjustmentType: z.enum([
      "MANUAL_CREDIT",
      "MANUAL_DEBIT",
      "SERVICE_RECOVERY_CREDIT",
    ]),
    amountMinor: moneyMinorStringSchema,
    reasonCode: z.string().trim().min(2).max(80),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();

export const customerCreditDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    branchId: uuidSchema.optional(),
    customerId: uuidSchema.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    balanceState: z
      .enum(["ALL", "HAS_BALANCE", "RESERVED", "ZERO_BALANCE", "DORMANT"])
      .default("ALL"),
    sourceType: z
      .enum(["ALL", "REFUND", "SERVICE_RECOVERY", "MANUAL"])
      .default("ALL"),
    activityFrom: z.string().date().optional(),
    activityTo: z.string().date().optional(),
    inactiveDays: z.coerce.number().int().min(1).max(3650).default(90),
    sort: z
      .enum([
        "CUSTOMER_NAME",
        "BALANCE_DESC",
        "BALANCE_ASC",
        "LAST_ACTIVITY_DESC",
        "LAST_ACTIVITY_ASC",
      ])
      .default("CUSTOMER_NAME"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.activityFrom && value.activityTo && value.activityFrom > value.activityTo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activityTo"],
        message: "The end date must not be before the start date",
      });
    }
  });

export const customerCreditLedgerDirectoryQuerySchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    group: z
      .enum(["ALL", "CREDIT", "REDEEM", "RESERVE", "REFUND", "ADJUSTMENT"])
      .default("ALL"),
    source: z
      .enum(["ALL", "REFUND", "POS", "MANUAL", "SERVICE_RECOVERY"])
      .default("ALL"),
    sign: z.enum(["ALL", "POSITIVE", "NEGATIVE"]).default("ALL"),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(["NEWEST", "OLDEST"]).default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date must not be before the start date",
      });
    }
  });

export const communicationPreferenceUpdateSchema = z
  .object({
    preferredLocale: z.enum(["vi-VN", "en-US"]),
    preferredTimezone: z.string().trim().min(1).max(100),
    emailAddress: z.string().trim().email().max(320).optional().nullable(),
    quietHoursStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .nullable(),
    quietHoursEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const consentCommandSchema = z
  .object({
    purpose: z.enum([
      "MARKETING_EMAIL",
      "REVIEW_REQUEST",
      "CUSTOMER_RESEARCH",
      "SERVICE_RECOVERY_CONTACT",
    ]),
    definitionId: uuidSchema.optional().nullable(),
    source: z.enum([
      "BOOKING_WEB",
      "CUSTOMER_PORTAL",
      "ADMIN_WEB",
      "IMPORT",
      "UNSUBSCRIBE_LINK",
      "API",
    ]),
    evidence: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const communicationTemplateSchema = z
  .object({
    code: z.string().trim().min(2).max(100),
    category: z.enum(["TRANSACTIONAL", "ENGAGEMENT", "MARKETING", "INTERNAL"]),
  })
  .strict();
export const communicationTemplateVersionSchema = z
  .object({
    locale: z.enum(["vi-VN", "en-US"]),
    subject: z.string().trim().min(1).max(200),
    htmlBody: z.string().min(1).max(100_000),
    plainTextBody: z.string().min(1).max(100_000),
    allowedVariables: z
      .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/))
      .max(100),
    requiredVariables: z
      .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/))
      .max(100),
    complianceFooter: z.string().max(5000).optional().nullable(),
  })
  .strict();
export const customerSegmentSchema = z
  .object({
    branchId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(2).max(120),
    filters: z.record(z.string(), z.unknown()),
  })
  .strict();
export const marketingCampaignTypes = [
  "PROMOTION",
  "NEWSLETTER",
  "NEW_SERVICE",
  "SEASONAL_CAMPAIGN",
  "MEMBERSHIP_OFFER",
  "LOYALTY_OFFER",
] as const;
export const marketingRiskLevels = ["STANDARD", "ELEVATED", "HIGH"] as const;

export const marketingCampaignSchema = z
  .object({
    branchId: uuidSchema.optional().nullable(),
    segmentId: uuidSchema,
    templateVersionId: uuidSchema,
    name: z.string().trim().min(2).max(160),
    campaignType: z.enum(marketingCampaignTypes),
    riskLevel: z.enum(marketingRiskLevels).default("STANDARD"),
  })
  .strict();
export const marketingCampaignDirectoryQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    branchId: uuidSchema.optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "SCHEDULED",
        "RUNNING",
        "PAUSED",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ])
      .optional(),
    campaignType: z.enum(marketingCampaignTypes).optional(),
    riskLevel: z.enum(marketingRiskLevels).optional(),
    segmentId: uuidSchema.optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    sort: z
      .enum(["NEWEST", "OLDEST", "SCHEDULE_ASC", "AUDIENCE_DESC", "SENT_DESC"])
      .default("NEWEST"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z
      .coerce
      .number()
      .int()
      .refine((value) => [10, 20, 50].includes(value), "Unsupported page size")
      .default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date must not be before the start date",
      });
    }
  });
export const marketingOverviewQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "The end date must not be before the start date",
      });
    }
  });
export const reviewSubmitSchema = z
  .object({
    token: z.string().min(32).max(4096),
    overallRating: z.number().int().min(1).max(5),
    serviceRating: z.number().int().min(1).max(5).optional(),
    cleanlinessRating: z.number().int().min(1).max(5).optional(),
    staffRating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(5000).optional(),
  })
  .strict();
export const recoveryCaseSchema = z
  .object({
    branchId: uuidSchema,
    customerId: uuidSchema,
    appointmentId: uuidSchema.optional().nullable(),
    invoiceId: uuidSchema.optional().nullable(),
    reviewId: uuidSchema.optional().nullable(),
    source: z.enum([
      "LOW_REVIEW",
      "CUSTOMER_COMPLAINT",
      "STAFF_REPORT",
      "REFUND_ESCALATION",
      "SERVICE_FAILURE",
      "MANUAL",
    ]),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    category: z.string().trim().min(2).max(100),
    summary: z.string().trim().min(3).max(2000),
    customerStatement: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();
export const recoveryCompensationSchema = z
  .object({
    compensationType: z.enum([
      "CUSTOMER_CREDIT",
      "LOYALTY_POINTS",
      "VOUCHER",
      "COMPLIMENTARY_SERVICE_FOUNDATION",
      "NO_MONETARY_COMPENSATION",
    ]),
    proposal: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

// Sprint 20 Wave 2 accounting reconciliation command contracts.  These
// schemas deliberately accept only server-owned versions and integer minor
// units; callers cannot select a period, bank GL account, or any internal
// posting metadata.
export const accountingVersionCommandSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2000).optional(),
  })
  .strict();

export const accountingStatementLineExcludeSchema = z
  .object({
    version: z.number().int().positive(),
    expectedMatchState: z.enum(["UNMATCHED", "SUGGESTED"]),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const accountingStatementLineRestoreSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const accountingReconciliationAdjustmentCreateSchema = z
  .object({
    amountMinor: z.string().regex(/^[1-9]\d*$/, "amountMinor must be positive integer minor units"),
    direction: z.enum(["DEBIT", "CREDIT"]),
    offsetAccountId: uuidSchema,
    accountingDate: z.string().date(),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const accountingReconciliationAdjustmentSubmitSchema = accountingVersionCommandSchema;
export const accountingReconciliationAdjustmentApproveSchema = accountingVersionCommandSchema;
export const accountingReconciliationAdjustmentRejectSchema = z
  .object({ version: z.number().int().positive(), reason: z.string().trim().min(3).max(2000) })
  .strict();
export const accountingReconciliationAdjustmentCancelSchema = z
  .object({ version: z.number().int().positive(), reason: z.string().trim().min(3).max(2000) })
  .strict();
export const accountingReconciliationAdjustmentPostSchema = accountingVersionCommandSchema;
