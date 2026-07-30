/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  communicationPreferenceUpdateSchema,
  communicationTemplateSchema,
  communicationTemplateVersionSchema,
  consentCommandSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { reduceConsent, renderTemplate } from "./engagement-domain.js";

@Injectable()
export class CommunicationService {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(BookingIdempotencyService) readonly idem: BookingIdempotencyService,
  ) {}
  access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((r) =>
        [
          "SALON_OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER",
          "ACCOUNTANT",
          "MARKETING",
          "NAIL_TECHNICIAN",
        ].includes(r),
      )
    )
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Support access grant required",
      });
  }
  branch(auth: AccessClaims, branchId?: string | null) {
    this.access(auth);
    if (
      branchId &&
      !auth.roles.includes("SALON_OWNER") &&
      !auth.branchIds.includes(branchId)
    )
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Branch is outside membership scope",
      });
  }
  owner(auth: AccessClaims) {
    this.access(auth);
    if (!auth.roles.includes("SALON_OWNER"))
      throw new ForbiddenException({
        code: "TENANT_WIDE_COMMUNICATION_OWNER_ONLY",
        message: "Tenant-wide communication management requires Salon Owner",
      });
  }
  command<T>(
    auth: AccessClaims,
    name: string,
    key: string,
    request: unknown,
    work: (c: PoolClient) => Promise<T>,
  ) {
    this.access(auth);
    return this.db.transaction(
      async (c) =>
        (
          await this.idem.execute(c, {
            tenantId: auth.tenantId,
            actorScope: `user:${auth.userId}`,
            command: name,
            key,
            request,
            work: async () => {
              const tenant = (await c.query<{ access_mode: string }>("SELECT access_mode FROM tenants WHERE id=$1 FOR SHARE",[auth.tenantId])).rows[0];
              if (["READ_ONLY","BILLING_ONLY","SUSPENDED","TERMINATED"].includes(tenant?.access_mode ?? "TERMINATED"))
                throw new ForbiddenException({ code: tenant?.access_mode === "SUSPENDED" ? "TENANT_SUSPENDED" : tenant?.access_mode === "TERMINATED" ? "TENANT_TERMINATED" : "TENANT_READ_ONLY", message: "Tenant access mode blocks engagement writes" });
              if (name.startsWith("marketing.")) {
                const entitlement = (await c.query<{ enabled: boolean | null }>("SELECT enabled FROM platform_entitlement_projections WHERE tenant_id=$1 AND entitlement_code='marketing.enabled'",[auth.tenantId])).rows[0];
                if (!entitlement?.enabled) throw new ForbiddenException({ code: "ENTITLEMENT_DENIED", message: "Marketing entitlement is disabled" });
                if (name.includes("schedule") || name.includes("resume")) {
                  const quota = (await c.query<{ quota_limit: string | null; unlimited: boolean }>("SELECT quota_limit,unlimited FROM platform_entitlement_projections WHERE tenant_id=$1 AND entitlement_code='marketing_email_monthly.max'",[auth.tenantId])).rows[0];
                  if (!quota?.unlimited) {
                    const used = BigInt((await c.query<{ quantity: string }>(`SELECT COALESCE(sum(u.quantity),0) quantity FROM platform_usage_aggregates u JOIN platform_usage_meter_definitions m ON m.id=u.meter_id WHERE u.tenant_id=$1 AND m.code='MARKETING_EMAIL_SENT' AND u.period_start=date_trunc('month',now())`,[auth.tenantId])).rows[0]?.quantity ?? 0);
                    if (used >= BigInt(quota?.quota_limit ?? 0)) throw new ForbiddenException({ code: "ENTITLEMENT_QUOTA_EXCEEDED", message: "Marketing email monthly quota exceeded" });
                  }
                }
              }
              return work(c);
            },
          })
        ).data,
    );
  }
  async evidence(
    c: PoolClient,
    auth: AccessClaims,
    event: string,
    type: string,
    id: string,
    requestId: string,
    branchId?: string | null,
    after: Record<string, unknown> = {},
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        branchId ?? null,
        auth.userId,
        event,
        type,
        id,
        JSON.stringify(after),
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        branchId ?? null,
        event,
        type,
        id,
        JSON.stringify({
          aggregateId: id,
          branchId: branchId ?? null,
          refetch: true,
        }),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
  notFound(code: string): never {
    throw new NotFoundException({
      code,
      message: "Customer engagement resource not found",
    });
  }
  conflict(
    code: string,
    message = "Command conflicts with current state",
  ): never {
    throw new ConflictException({ code, message });
  }
  hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  preferences(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return this.db
      .query<any>(
        `SELECT customer_id "customerId",preferred_locale "preferredLocale",preferred_timezone "preferredTimezone",email_address "emailAddress",email_status "emailStatus",marketing_email_allowed "marketingEmailAllowed",review_request_allowed "reviewRequestAllowed",service_recovery_contact_allowed "serviceRecoveryContactAllowed",quiet_hours_start::text "quietHoursStart",quiet_hours_end::text "quietHoursEnd",version,updated_at "updatedAt" FROM customer_communication_preferences WHERE tenant_id=$1 AND customer_id=$2`,
        [auth.tenantId, customerId],
      )
      .then(
        (r) => r.rows[0] ?? this.notFound("COMMUNICATION_PREFERENCE_NOT_FOUND"),
      );
  }
  async ownCustomerId(auth: AccessClaims) {
    const row = (
      await this.db.query<any>(
        `SELECT c.id FROM customers c JOIN users u ON u.id=$2 WHERE c.tenant_id=$1 AND ((u.email IS NOT NULL AND lower(c.email_normalized)=lower(u.email)) OR (u.phone_e164 IS NOT NULL AND c.phone_normalized=u.phone_e164)) ORDER BY c.id LIMIT 1`,
        [auth.tenantId, auth.userId],
      )
    ).rows[0];
    if (!row) this.notFound("CUSTOMER_NOT_FOUND");
    return row.id as string;
  }
  updatePreferences(
    auth: AccessClaims,
    customerId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = communicationPreferenceUpdateSchema.parse(input);
    return this.command(
      auth,
      "communication.preference.update",
      key,
      { customerId, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM customer_communication_preferences WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE",
            [auth.tenantId, customerId],
          )
        ).rows[0];
        if (!row) this.notFound("COMMUNICATION_PREFERENCE_NOT_FOUND");
        if (row.version !== b.version) this.conflict("VERSION_CONFLICT");
        const updated = (
          await c.query<any>(
            `UPDATE customer_communication_preferences SET preferred_locale=$3,preferred_timezone=$4,email_address=$5,quiet_hours_start=$6,quiet_hours_end=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND customer_id=$2 RETURNING customer_id "customerId",preferred_locale "preferredLocale",preferred_timezone "preferredTimezone",email_address "emailAddress",email_status "emailStatus",version`,
            [
              auth.tenantId,
              customerId,
              b.preferredLocale,
              b.preferredTimezone,
              b.emailAddress ?? null,
              b.quietHoursStart ?? null,
              b.quietHoursEnd ?? null,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "communication.preference_updated",
          "customer_communication_preference",
          customerId,
          requestId,
          null,
          {
            preferredLocale: b.preferredLocale,
            emailChanged: row.email_address !== (b.emailAddress ?? null),
          },
        );
        return updated;
      },
    );
  }
  consents(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return this.db
      .query<any>(
        `SELECT s.purpose,s.state,s.version,s.updated_at "updatedAt",e.id "lastEventId",e.event_type "lastEventType",e.source FROM customer_consent_states s LEFT JOIN customer_consent_events e ON e.tenant_id=s.tenant_id AND e.id=s.last_event_id WHERE s.tenant_id=$1 AND s.customer_id=$2 ORDER BY s.purpose`,
        [auth.tenantId, customerId],
      )
      .then((r) => r.rows);
  }
  consent(
    auth: AccessClaims,
    customerId: string,
    action: "GRANT" | "WITHDRAW",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = consentCommandSchema.parse(input);
    const resulting = action === "GRANT" ? "GRANTED" : "WITHDRAWN";
    return this.command(
      auth,
      `communication.consent.${action.toLowerCase()}`,
      key,
      { customerId, ...b },
      async (c) => {
        const customer = await c.query(
          "SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, customerId],
        );
        if (!customer.rowCount) this.notFound("CUSTOMER_NOT_FOUND");
        const state = (
          await c.query<any>(
            "SELECT * FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2 AND purpose=$3 FOR UPDATE",
            [auth.tenantId, customerId, b.purpose],
          )
        ).rows[0];
        let definition: any = null;
        if (action === "GRANT") {
          definition = (
            await c.query<any>(
              `SELECT * FROM consent_definitions WHERE tenant_id=$1 AND id=COALESCE($2::uuid,id) AND purpose=$3 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY definition_version DESC LIMIT 1`,
              [auth.tenantId, b.definitionId ?? null, b.purpose],
            )
          ).rows[0];
          if (!definition) this.notFound("CONSENT_DEFINITION_NOT_FOUND");
        }
        const next = reduceConsent(state?.state ?? "NOT_GRANTED", action);
        const id = randomUUID();
        await c.query(
          `INSERT INTO customer_consent_events(id,tenant_id,customer_id,purpose,event_type,resulting_state,consent_definition_id,definition_version,consent_text_hash,source,actor_user_id,evidence_redacted_json,request_id,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            id,
            auth.tenantId,
            customerId,
            b.purpose,
            action,
            next,
            definition?.id ?? null,
            definition?.definition_version ?? null,
            definition?.consent_text_hash ?? null,
            b.source,
            auth.userId,
            JSON.stringify(b.evidence),
            requestId,
            this.hash(
              `${auth.tenantId}:${customerId}:${b.purpose}:${action}:${key}`,
            ),
          ],
        );
        await c.query(
          `INSERT INTO customer_consent_states(tenant_id,customer_id,purpose,state,last_event_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,customer_id,purpose) DO UPDATE SET state=EXCLUDED.state,last_event_id=EXCLUDED.last_event_id,version=customer_consent_states.version+1,updated_at=now()`,
          [auth.tenantId, customerId, b.purpose, resulting, id],
        );
        const column =
          b.purpose === "MARKETING_EMAIL"
            ? "marketing_email_allowed"
            : b.purpose === "REVIEW_REQUEST"
              ? "review_request_allowed"
              : b.purpose === "SERVICE_RECOVERY_CONTACT"
                ? "service_recovery_contact_allowed"
                : null;
        if (column)
          await c.query(
            `UPDATE customer_communication_preferences SET ${column}=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND customer_id=$2`,
            [auth.tenantId, customerId, action === "GRANT"],
          );
        if (action === "WITHDRAW" && b.purpose === "MARKETING_EMAIL") {
          await c.query(
            `INSERT INTO communication_suppressions(tenant_id,customer_id,purpose,reason,source_event_id) VALUES($1,$2,$3,'MARKETING_WITHDRAWN',$4) ON CONFLICT DO NOTHING`,
            [auth.tenantId, customerId, b.purpose, id],
          );
          await c.query(
            `UPDATE communication_messages SET status='SUPPRESSED',suppression_reason='MARKETING_WITHDRAWN',claim_token=NULL,claim_expires_at=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND customer_id=$2 AND category='MARKETING' AND status IN('PENDING','SCHEDULED','FAILED','PROCESSING')`,
            [auth.tenantId, customerId],
          );
          await c.query(
            `UPDATE marketing_frequency_reservations r SET status='RELEASED',released_at=now()
             FROM communication_messages m WHERE r.tenant_id=$1 AND m.tenant_id=r.tenant_id AND m.id=r.message_id
             AND m.customer_id=$2 AND r.status='ACTIVE'`,
            [auth.tenantId, customerId],
          );
        }
        if (action === "WITHDRAW" && b.purpose === "REVIEW_REQUEST") {
          await c.query(
            `UPDATE communication_messages SET status='SUPPRESSED',suppression_reason='REVIEW_CONSENT_WITHDRAWN',claim_token=NULL,claim_expires_at=NULL,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND customer_id=$2 AND purpose='REVIEW_REQUEST' AND status IN('PENDING','SCHEDULED','FAILED','PROCESSING')`,
            [auth.tenantId, customerId],
          );
          await c.query(
            `UPDATE review_requests SET status='SUPPRESSED' WHERE tenant_id=$1 AND customer_id=$2 AND status IN('PENDING','SENT')
             AND NOT EXISTS(SELECT 1 FROM communication_messages m WHERE m.tenant_id=$1 AND m.review_request_id=review_requests.id AND m.status IN('SENT','DELIVERED'))`,
            [auth.tenantId, customerId],
          );
        }
        await this.evidence(
          c,
          auth,
          `communication.consent_${action.toLowerCase()}`,
          "customer_consent",
          id,
          requestId,
          null,
          { customerId, purpose: b.purpose, resultingState: resulting },
        );
        return { id, customerId, purpose: b.purpose, state: resulting };
      },
    );
  }

  templates(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query<any>(
        `SELECT id,code,category,channel,status,version,created_at "createdAt",updated_at "updatedAt" FROM communication_templates WHERE tenant_id=$1 ORDER BY code`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  template(auth: AccessClaims, id: string) {
    this.access(auth);
    return this.db
      .query<any>(
        `SELECT t.*,COALESCE(json_agg(v ORDER BY v.version_number,v.locale) FILTER(WHERE v.id IS NOT NULL),'[]') versions FROM communication_templates t LEFT JOIN communication_template_versions v ON v.tenant_id=t.tenant_id AND v.template_id=t.id WHERE t.tenant_id=$1 AND t.id=$2 GROUP BY t.id`,
        [auth.tenantId, id],
      )
      .then((r) => r.rows[0] ?? this.notFound("TEMPLATE_NOT_FOUND"));
  }
  createTemplate(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.owner(auth);
    const b = communicationTemplateSchema.parse(input);
    return this.command(
      auth,
      "communication.template.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO communication_templates(id,tenant_id,code,category,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [id, auth.tenantId, b.code, b.category, auth.userId],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "communication.template_created",
          "communication_template",
          id,
          requestId,
          null,
          { code: b.code, category: b.category },
        );
        return row;
      },
    );
  }
  addTemplateVersion(
    auth: AccessClaims,
    templateId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.owner(auth);
    const b = communicationTemplateVersionSchema.parse(input);
    return this.command(
      auth,
      "communication.template.version.create",
      key,
      { templateId, ...b },
      async (c) => {
        const template = (
          await c.query<any>(
            "SELECT * FROM communication_templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, templateId],
          )
        ).rows[0];
        if (!template) this.notFound("TEMPLATE_NOT_FOUND");
        const number = Number(
          (
            await c.query<any>(
              "SELECT COALESCE(max(version_number),0)+1 n FROM communication_template_versions WHERE tenant_id=$1 AND template_id=$2",
              [auth.tenantId, templateId],
            )
          ).rows[0].n,
        );
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO communication_template_versions(id,tenant_id,template_id,version_number,locale,subject,html_body,plain_text_body,allowed_variables_json,required_variables_json,compliance_footer,content_hash,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [
              id,
              auth.tenantId,
              templateId,
              number,
              b.locale,
              b.subject,
              b.htmlBody,
              b.plainTextBody,
              JSON.stringify(b.allowedVariables),
              JSON.stringify(b.requiredVariables),
              b.complianceFooter ?? null,
              this.hash(JSON.stringify(b)),
              auth.userId,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "communication.template_version_created",
          "communication_template_version",
          id,
          requestId,
          null,
          { templateId, versionNumber: number, locale: b.locale },
        );
        return row;
      },
    );
  }
  activateTemplateVersion(
    auth: AccessClaims,
    templateId: string,
    versionId: string,
    key: string,
    requestId: string,
  ) {
    this.owner(auth);
    return this.command(
      auth,
      "communication.template.version.activate",
      key,
      { templateId, versionId },
      async (c) => {
        const version = (
          await c.query<any>(
            "SELECT * FROM communication_template_versions WHERE tenant_id=$1 AND template_id=$2 AND id=$3",
            [auth.tenantId, templateId, versionId],
          )
        ).rows[0];
        if (!version) this.notFound("TEMPLATE_VERSION_NOT_FOUND");
        await c.query(
          "UPDATE communication_templates SET status='ACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, templateId],
        );
        await c.query(
          "UPDATE communication_template_versions SET status=CASE WHEN id=$3 THEN 'ACTIVE' ELSE CASE WHEN status='ACTIVE' AND locale=$4 THEN 'SUPERSEDED' ELSE status END END,effective_from=CASE WHEN id=$3 THEN now() ELSE effective_from END,effective_to=CASE WHEN id<>$3 AND status='ACTIVE' AND locale=$4 THEN now() ELSE effective_to END WHERE tenant_id=$1 AND template_id=$2",
          [auth.tenantId, templateId, versionId, version.locale],
        );
        await this.evidence(
          c,
          auth,
          "communication.template_version_activated",
          "communication_template_version",
          versionId,
          requestId,
          null,
          { templateId },
        );
        return { id: versionId, status: "ACTIVE" };
      },
    );
  }
  deactivateTemplate(
    auth: AccessClaims,
    templateId: string,
    key: string,
    requestId: string,
  ) {
    this.owner(auth);
    return this.command(
      auth,
      "communication.template.deactivate",
      key,
      { templateId },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE communication_templates SET status='INACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, templateId],
          )
        ).rows[0];
        if (!row) this.notFound("TEMPLATE_NOT_FOUND");
        await this.evidence(
          c,
          auth,
          "communication.template_deactivated",
          "communication_template",
          templateId,
          requestId,
        );
        return row;
      },
    );
  }

  rules(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query<any>(
        "SELECT * FROM communication_rules WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  createRule(auth: AccessClaims, input: any, key: string, requestId: string) {
    const b = input as any;
    if (!b.branchId) this.owner(auth);
    else this.branch(auth, b.branchId);
    return this.command(
      auth,
      "communication.rule.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO communication_rules(id,tenant_id,branch_id,domain_event,purpose,template_version_id,delay_seconds,recipient_resolver,eligibility_policy_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              auth.tenantId,
              b.branchId ?? null,
              String(b.domainEvent),
              String(b.purpose),
              String(b.templateVersionId),
              Number(b.delaySeconds ?? 0),
              String(b.recipientResolver ?? "APPOINTMENT_CUSTOMER"),
              JSON.stringify(b.eligibilityPolicy ?? {}),
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "communication.rule_created",
          "communication_rule",
          id,
          requestId,
          b.branchId,
        );
        return row;
      },
    );
  }
  ruleStatus(
    auth: AccessClaims,
    id: string,
    status: string,
    key: string,
    requestId: string,
  ) {
    return this.command(
      auth,
      `communication.rule.${status.toLowerCase()}`,
      key,
      { id, status },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE communication_rules SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        if (!row) this.notFound("COMMUNICATION_RULE_NOT_FOUND");
        if (!row.branch_id) this.owner(auth);
        else this.branch(auth, row.branch_id);
        await this.evidence(
          c,
          auth,
          "communication.rule_status_changed",
          "communication_rule",
          id,
          requestId,
          row.branch_id,
          { status },
        );
        return row;
      },
    );
  }
  messages(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query<any>(
        `SELECT id,branch_id "branchId",customer_id "customerId",category,purpose,channel,status,scheduled_at "scheduledAt",sent_at "sentAt",attempt_count "attemptCount",safe_error_code "safeErrorCode",suppression_reason "suppressionReason",created_at "createdAt" FROM communication_messages WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC LIMIT 500`,
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  message(auth: AccessClaims, id: string) {
    this.access(auth);
    return this.db
      .query<any>(
        "SELECT id,branch_id,customer_id,category,purpose,channel,status,scheduled_at,sent_at,attempt_count,safe_error_code,suppression_reason,created_at,updated_at FROM communication_messages WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.notFound("COMMUNICATION_MESSAGE_NOT_FOUND");
        this.branch(auth, row.branch_id);
        return row;
      });
  }
  attempts(auth: AccessClaims, id: string) {
    return Promise.resolve(this.message(auth, id)).then(() =>
      this.db
        .query<any>(
          "SELECT attempt_number,provider_reference,result,safe_error_code,retry_after,redacted_metadata_json,created_at FROM communication_delivery_attempts WHERE tenant_id=$1 AND message_id=$2 ORDER BY attempt_number",
          [auth.tenantId, id],
        )
        .then((r) => r.rows),
    );
  }
  retryMessage(auth: AccessClaims, id: string, key: string, requestId: string) {
    return this.command(
      auth,
      "communication.message.retry",
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM communication_messages WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("COMMUNICATION_MESSAGE_NOT_FOUND");
        this.branch(auth, row.branch_id);
        if (!["FAILED", "DEAD_LETTER"].includes(row.status))
          this.conflict("MESSAGE_RETRY_NOT_ALLOWED");
        const updated = (
          await c.query<any>(
            "UPDATE communication_messages SET status='PENDING',next_attempt_at=now(),safe_error_code=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "communication.message_retried",
          "communication_message",
          id,
          requestId,
          row.branch_id,
        );
        return updated;
      },
    );
  }
  internal(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query<any>(
        "SELECT * FROM internal_notifications WHERE tenant_id=$1 AND (recipient_user_id IS NULL OR recipient_user_id=$2) AND ($3::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($3::uuid[])) ORDER BY created_at DESC LIMIT 200",
        [
          auth.tenantId,
          auth.userId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  internalStatus(
    auth: AccessClaims,
    id: string,
    status: "READ" | "DISMISSED",
    key: string,
    requestId: string,
  ) {
    return this.command(
      auth,
      `communication.internal.${status.toLowerCase()}`,
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            `UPDATE internal_notifications SET status=$3,read_at=CASE WHEN $3='READ' THEN now() ELSE read_at END,dismissed_at=CASE WHEN $3='DISMISSED' THEN now() ELSE dismissed_at END WHERE tenant_id=$1 AND id=$2 AND (recipient_user_id IS NULL OR recipient_user_id=$4) RETURNING *`,
            [auth.tenantId, id, status, auth.userId],
          )
        ).rows[0];
        if (!row) this.notFound("INTERNAL_NOTIFICATION_NOT_FOUND");
        await this.evidence(
          c,
          auth,
          "communication.internal_updated",
          "internal_notification",
          id,
          requestId,
          row.branch_id,
          { status },
        );
        return row;
      },
    );
  }

  render(version: any, variables: Record<string, unknown>) {
    return {
      subject: renderTemplate(
        version.subject,
        variables,
        version.allowed_variables_json,
        version.required_variables_json,
      ),
      html: renderTemplate(
        version.html_body,
        variables,
        version.allowed_variables_json,
        version.required_variables_json,
      ),
      text: renderTemplate(
        version.plain_text_body,
        variables,
        version.allowed_variables_json,
        version.required_variables_json,
      ),
    };
  }
}
