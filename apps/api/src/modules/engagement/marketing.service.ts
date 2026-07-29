/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  customerSegmentSchema,
  marketingCampaignSchema,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import { CommunicationService } from "./communication.service.js";
import { assertTransition, campaignTransitions } from "./engagement-domain.js";

@Injectable()
export class MarketingService {
  constructor(
    @Inject(CommunicationService) readonly core: CommunicationService,
  ) {}
  segments(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  segment(auth: AccessClaims, id: string) {
    return this.core.db
      .query<any>(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        return row;
      });
  }
  createSegment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = customerSegmentSchema.parse(input);
    this.assertMarketingScope(auth, b.branchId ?? null);
    this.assertSafeFilters(b.filters);
    this.assertFilterScope(auth, b.branchId ?? null, b.filters);
    return this.core.command(
      auth,
      "marketing.segment.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        const row = (
          await c.query<any>(
            "INSERT INTO customer_segments(id,tenant_id,branch_id,name,filter_json,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              id,
              auth.tenantId,
              b.branchId ?? null,
              b.name,
              JSON.stringify(b.filters),
              auth.userId,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_created",
          "customer_segment",
          id,
          requestId,
          b.branchId,
        );
        return row;
      },
    );
  }
  updateSegment(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const raw = input as any;
    this.assertSafeFilters(raw.filters ?? {});
    return this.core.command(
      auth,
      "marketing.segment.update",
      key,
      { id, ...raw },
      async (c) => {
        const current = (
          await c.query<any>(
            "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!current) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, current.branch_id);
        this.assertFilterScope(auth, current.branch_id, raw.filters ?? {});
        if (raw.version && current.version !== raw.version)
          this.core.conflict("VERSION_CONFLICT");
        const row = (
          await c.query<any>(
            "UPDATE customer_segments SET name=COALESCE($3,name),filter_json=COALESCE($4,filter_json),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              raw.name ?? null,
              raw.filters ? JSON.stringify(raw.filters) : null,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_updated",
          "customer_segment",
          id,
          requestId,
          current.branch_id,
        );
        return row;
      },
    );
  }
  segmentStatus(
    auth: AccessClaims,
    id: string,
    status: "ACTIVE" | "INACTIVE",
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `marketing.segment.${status.toLowerCase()}`,
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE customer_segments SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        if (!row) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        await this.core.evidence(
          c,
          auth,
          "marketing.segment_status_changed",
          "customer_segment",
          id,
          requestId,
          row.branch_id,
          { status },
        );
        return row;
      },
    );
  }
  async previewSegment(auth: AccessClaims, id: string) {
    const segment = await this.segment(auth, id);
    this.assertFilterScope(auth, segment.branch_id, segment.filter_json);
    const audience = await this.eligibleCustomers(
      auth,
      segment.branch_id,
      segment.filter_json,
      20,
    );
    return {
      count: Number(
        (
          await this.core.db.query<any>(
            this.eligibleCountSql(),
            this.eligibleParams(auth, segment.branch_id, segment.filter_json),
          )
        ).rows[0].count,
      ),
      sample: audience.map((x: any) => ({
        customerId: x.customer_id,
        displayName: this.redact(x.display_name),
        locale: x.preferred_locale,
        contactable: true,
      })),
      redacted: true,
    };
  }

  campaigns(auth: AccessClaims) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC",
        [
          auth.tenantId,
          auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
        ],
      )
      .then((r) => r.rows);
  }
  campaign(auth: AccessClaims, id: string) {
    return this.core.db
      .query<any>(
        "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        return row;
      });
  }
  createCampaign(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = marketingCampaignSchema.parse(input);
    this.assertMarketingScope(auth, b.branchId ?? null);
    return this.core.command(
      auth,
      "marketing.campaign.create",
      key,
      b,
      async (c) => {
        const segment = (
          await c.query<any>(
            "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
            [auth.tenantId, b.segmentId],
          )
        ).rows[0];
        if (!segment) this.core.notFound("SEGMENT_NOT_FOUND");
        this.assertMarketingScope(auth, segment.branch_id);
        const campaignBranch = b.branchId ?? segment.branch_id ?? null;
        this.assertMarketingScope(auth, campaignBranch);
        if (segment.branch_id && campaignBranch !== segment.branch_id)
          this.core.conflict("CAMPAIGN_SEGMENT_BRANCH_MISMATCH");
        const version = await c.query(
          "SELECT 1 FROM communication_template_versions v JOIN communication_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id WHERE v.tenant_id=$1 AND v.id=$2 AND v.status='ACTIVE' AND t.category='MARKETING'",
          [auth.tenantId, b.templateVersionId],
        );
        if (!version.rowCount) this.core.notFound("TEMPLATE_VERSION_NOT_FOUND");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO marketing_campaigns(id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,risk_level,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              auth.tenantId,
              campaignBranch,
              b.segmentId,
              b.templateVersionId,
              b.name,
              b.campaignType,
              b.riskLevel,
              auth.userId,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.campaign_created",
          "marketing_campaign",
          id,
          requestId,
          row.branch_id,
        );
        return row;
      },
    );
  }
  updateCampaign(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "marketing.campaign.update",
      key,
      { id, ...input },
      async (c) => {
        const current = (
          await c.query<any>(
            "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!current) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, current.branch_id);
        if (current.status !== "DRAFT")
          this.core.conflict("CAMPAIGN_STATUS_INVALID");
        if (input.version && input.version !== current.version)
          this.core.conflict("VERSION_CONFLICT");
        const row = (
          await c.query<any>(
            "UPDATE marketing_campaigns SET name=COALESCE($3,name),campaign_type=COALESCE($4,campaign_type),risk_level=COALESCE($5,risk_level),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              input.name ?? null,
              input.campaignType ?? null,
              input.riskLevel ?? null,
            ],
          )
        ).rows[0];
        await this.core.evidence(
          c,
          auth,
          "marketing.campaign_updated",
          "marketing_campaign",
          id,
          requestId,
          current.branch_id,
        );
        return row;
      },
    );
  }
  async previewCampaign(auth: AccessClaims, id: string) {
    const campaign = await this.campaign(auth, id);
    const segmentPreview = await this.previewSegment(auth, campaign.segment_id);
    const settings = (
      await this.core.db.query<any>(
        "SELECT campaign_dual_control_threshold FROM communication_settings WHERE tenant_id=$1",
        [auth.tenantId],
      )
    ).rows[0];
    return {
      ...segmentPreview,
      dualControlRequired:
        segmentPreview.count >=
          Number(settings.campaign_dual_control_threshold) ||
        campaign.risk_level !== "STANDARD",
      consentMandatory: true,
      channel: "EMAIL",
    };
  }
  transition(
    auth: AccessClaims,
    id: string,
    target: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `marketing.campaign.${target.toLowerCase()}`,
      key,
      { id, target, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("CAMPAIGN_NOT_FOUND");
        this.assertMarketingScope(auth, row.branch_id);
        if (input?.version && input.version !== row.version)
          this.core.conflict("VERSION_CONFLICT");
        assertTransition(
          campaignTransitions,
          row.status,
          target,
          "CAMPAIGN_STATUS_INVALID",
        );
        if (target === "APPROVED" && row.requested_by_user_id === auth.userId)
          throw new ForbiddenException({
            code: "CAMPAIGN_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve campaign",
          });
        let generation = row.audience_generation;
        if (target === "APPROVED") {
          generation += 1;
          await this.snapshotAudience(c, auth, row, generation);
        }
        const scheduledAt =
          target === "SCHEDULED"
            ? new Date(input?.scheduledAt ?? Date.now())
            : null;
        const updated = (
          await c.query<any>(
            `UPDATE marketing_campaigns SET status=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,scheduled_at=CASE WHEN $3='SCHEDULED' THEN $5 ELSE scheduled_at END,started_at=CASE WHEN $3='RUNNING' THEN now() ELSE started_at END,completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE completed_at END,audience_generation=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, target, auth.userId, scheduledAt, generation],
          )
        ).rows[0];
        if (target === "CANCELLED") {
          await c.query(
            `UPDATE communication_messages SET status='CANCELLED',suppression_reason='CAMPAIGN_CANCELLED',claim_token=NULL,claim_expires_at=NULL,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND marketing_campaign_id=$2 AND status IN('PENDING','SCHEDULED','FAILED','PROCESSING')`,
            [auth.tenantId, id],
          );
          await c.query(
            `UPDATE marketing_frequency_reservations r SET status='RELEASED',released_at=now()
             FROM communication_messages m WHERE r.tenant_id=$1 AND m.tenant_id=r.tenant_id AND m.id=r.message_id
             AND m.marketing_campaign_id=$2 AND r.status='ACTIVE'`,
            [auth.tenantId, id],
          );
          await c.query(
            `UPDATE marketing_campaign_audience SET status='CANCELLED',skipped_reason='CAMPAIGN_CANCELLED'
             WHERE tenant_id=$1 AND campaign_id=$2 AND generation=$3 AND status='ELIGIBLE'`,
            [auth.tenantId, id, generation],
          );
        }
        await this.core.evidence(
          c,
          auth,
          `marketing.campaign_${target.toLowerCase()}`,
          "marketing_campaign",
          id,
          requestId,
          row.branch_id,
          { generation },
        );
        return updated;
      },
    );
  }
  audience(auth: AccessClaims, id: string) {
    return Promise.resolve(this.campaign(auth, id)).then(() =>
      this.core.db
        .query<any>(
          `SELECT customer_id "customerId",locale,timezone,status,skipped_reason "skippedReason",snapshotted_at "snapshottedAt" FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY snapshotted_at,id`,
          [auth.tenantId, id],
        )
        .then((r) => r.rows),
    );
  }
  async report(auth: AccessClaims, id: string) {
    await this.campaign(auth, id);
    const rows = (
      await this.core.db.query<any>(
        "SELECT status,count(*)::int count FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 GROUP BY status",
        [auth.tenantId, id],
      )
    ).rows;
    return {
      campaignId: id,
      counts: Object.fromEntries(rows.map((r: any) => [r.status, r.count])),
      generatedAt: new Date().toISOString(),
    };
  }

  private async snapshotAudience(
    c: any,
    auth: AccessClaims,
    campaign: any,
    generation: number,
  ) {
    const segment = (
      await c.query(
        "SELECT * FROM customer_segments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, campaign.segment_id],
      )
    ).rows[0];
    const settings = (
      await c.query(
        "SELECT campaign_audience_limit FROM communication_settings WHERE tenant_id=$1",
        [auth.tenantId],
      )
    ).rows[0];
    this.assertFilterScope(auth, campaign.branch_id, segment.filter_json);
    const count = Number(
      (
        await c.query(
          this.eligibleCountSql(),
          this.eligibleParams(auth, campaign.branch_id, segment.filter_json),
        )
      ).rows[0].count,
    );
    const audienceLimit = Number(settings?.campaign_audience_limit ?? 100000);
    if (count > audienceLimit)
      this.core.conflict("CAMPAIGN_AUDIENCE_LIMIT_EXCEEDED");
    const eligible = await this.eligibleCustomers(
      auth,
      campaign.branch_id,
      segment.filter_json,
      audienceLimit,
      c,
    );
    for (const customer of eligible)
      await c.query(
        `INSERT INTO marketing_campaign_audience(tenant_id,campaign_id,customer_id,generation,consent_event_id,contact_hash,contact_reference,locale,timezone,segment_version,eligibility_snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [
          auth.tenantId,
          campaign.id,
          customer.customer_id,
          generation,
          customer.last_event_id,
          this.core.hash(customer.email_address),
          `preference:${customer.customer_id}`,
          customer.preferred_locale,
          customer.preferred_timezone,
          segment.version,
          JSON.stringify({
            consent: "GRANTED",
            emailStatus: "VERIFIED",
            segmentVersion: segment.version,
            branchId: campaign.branch_id,
          }),
        ],
      );
  }
  private eligibleCustomers(
    auth: AccessClaims,
    branchId: string | null,
    filters: any,
    limit: number,
    client = this.core.db,
  ) {
    return client
      .query<any>(
        `${this.eligibleSelectSql()} LIMIT ${Math.min(limit, 100_000)}`,
        this.eligibleParams(auth, branchId, filters),
      )
      .then((r: any) => r.rows);
  }
  private eligibleSelectSql() {
    return `SELECT c.id customer_id,c.display_name,p.email_address,p.preferred_locale,p.preferred_timezone,s.last_event_id FROM customers c JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id JOIN customer_consent_states s ON s.tenant_id=c.tenant_id AND s.customer_id=c.id AND s.purpose='MARKETING_EMAIL' LEFT JOIN customer_tag_assignments ta ON ta.tenant_id=c.tenant_id AND ta.customer_id=c.id WHERE c.tenant_id=$1 AND s.state='GRANTED' AND p.marketing_email_allowed AND p.email_status='VERIFIED' AND p.email_address IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication_suppressions x WHERE x.tenant_id=c.tenant_id AND x.customer_id=c.id AND x.active AND (x.purpose IS NULL OR x.purpose='MARKETING_EMAIL')) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.customer_id=c.id AND a.branch_id=$2)) AND ($3::text IS NULL OR p.preferred_locale=$3) AND ($4::uuid IS NULL OR ta.tag_id=$4) GROUP BY c.id,c.display_name,p.email_address,p.preferred_locale,p.preferred_timezone,s.last_event_id ORDER BY c.id`;
  }
  private eligibleCountSql() {
    return `SELECT count(DISTINCT c.id)::int count FROM customers c JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id JOIN customer_consent_states s ON s.tenant_id=c.tenant_id AND s.customer_id=c.id AND s.purpose='MARKETING_EMAIL' LEFT JOIN customer_tag_assignments ta ON ta.tenant_id=c.tenant_id AND ta.customer_id=c.id WHERE c.tenant_id=$1 AND s.state='GRANTED' AND p.marketing_email_allowed AND p.email_status='VERIFIED' AND p.email_address IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication_suppressions x WHERE x.tenant_id=c.tenant_id AND x.customer_id=c.id AND x.active AND (x.purpose IS NULL OR x.purpose='MARKETING_EMAIL')) AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.customer_id=c.id AND a.branch_id=$2)) AND ($3::text IS NULL OR p.preferred_locale=$3) AND ($4::uuid IS NULL OR ta.tag_id=$4)`;
  }
  private eligibleParams(
    auth: AccessClaims,
    branchId: string | null,
    filters: any,
  ) {
    return [
      auth.tenantId,
      filters?.branchVisited ?? branchId,
      filters?.locale ?? null,
      filters?.tagId ?? null,
    ];
  }
  private assertSafeFilters(filters: Record<string, unknown>) {
    const allowed = new Set([
      "branchVisited",
      "locale",
      "contactable",
      "tagId",
      "marketingConsent",
    ]);
    const keys = Object.keys(filters);
    if (keys.length > 20 || keys.some((x) => !allowed.has(x)))
      this.core.conflict("SEGMENT_FILTER_NOT_SUPPORTED");
    if (filters.marketingConsent === false)
      this.core.conflict("MARKETING_CONSENT_FILTER_REQUIRED");
    if (filters.contactable === false)
      this.core.conflict("SEGMENT_FILTER_NOT_SUPPORTED");
  }
  private assertFilterScope(
    auth: AccessClaims,
    objectBranchId: string | null,
    filters: Record<string, unknown>,
  ) {
    const branchVisited = filters.branchVisited;
    if (typeof branchVisited !== "string") return;
    this.core.branch(auth, branchVisited);
    if (objectBranchId && branchVisited !== objectBranchId)
      this.core.conflict("SEGMENT_FILTER_BRANCH_MISMATCH");
  }
  private assertMarketingScope(auth: AccessClaims, branchId: string | null) {
    if (!branchId && !auth.roles.includes("SALON_OWNER"))
      throw new ForbiddenException({
        code: "TENANT_WIDE_MARKETING_OWNER_ONLY",
        message: "Tenant-wide marketing objects require Salon Owner",
      });
    this.core.branch(auth, branchId);
  }
  private redact(name: string) {
    return name ? `${name.slice(0, 1)}***` : "***";
  }
}
