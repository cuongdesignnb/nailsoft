import { z } from "zod";
export const uuidSchema = z.string().uuid();
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
export const publicCreateAppointmentSchema = z
  .object({
    holdId: uuidSchema,
    holdToken: z.string().min(1),
    customer: publicAppointmentCustomerSchema,
    contactVerificationToken: z.string().min(1),
    customerNote: z.string().max(2000).optional(),
    marketingConsent: z.boolean(),
    acceptedPolicyVersion: z.number().int().positive(),
    acceptedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const bookingCustomerSearchSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const bookingCustomerCreateSchema = publicAppointmentCustomerSchema;
export const appointmentVersionSchema = z.object({
  version: z.number().int().positive(),
});
export const appointmentCancelSchema = appointmentVersionSchema.extend({
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().max(2000).optional(),
  actorType: z.enum(["USER", "CUSTOMER"]).default("USER"),
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
export const financialExportSchema = z
  .object({
    branchId: uuidSchema.optional(),
    exportType: z.enum([
      "REFUNDS",
      "CREDIT_NOTES",
      "COMMISSION_ENTRIES",
      "COMMISSION_STATEMENTS",
      "NET_SALES",
    ]),
    filters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
