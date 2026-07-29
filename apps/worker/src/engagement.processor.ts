/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { EmailProvider } from "./email.provider.js";

@Injectable()
export class EngagementProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 3,
  });
  constructor(
    @Inject(EmailProvider) private readonly provider: EmailProvider,
  ) {}
  async run() {
    const counts = await Promise.all([
      this.generateTransactional(),
      this.scheduleReminders(),
      this.startCampaigns(),
      this.scheduleReviewRequests(),
      this.expireReviewRequests(),
      this.warnRecoverySla(),
      this.deliverOne(),
    ]);
    return counts.reduce((sum, value) => sum + value, 0);
  }

  async generateTransactional() {
    const events = (
      await this.pool.query<any>(
        `SELECT o.id,o.tenant_id,o.branch_id,o.event_type,o.aggregate_id,o.payload_json FROM outbox_events o WHERE o.event_type IN('appointment.confirmed','appointment.rescheduled','appointment.cancelled','invoice.issued','gift_card.delivery_requested','service_recovery.status_changed') AND o.created_at>now()-interval '30 days' ORDER BY o.created_at LIMIT 100`,
      )
    ).rows;
    let count = 0;
    for (const event of events) {
      const rule = (
        await this.pool.query<any>(
          `SELECT r.*,v.locale,v.subject,v.html_body,v.plain_text_body,v.allowed_variables_json,v.required_variables_json FROM communication_rules r JOIN communication_template_versions v ON v.tenant_id=r.tenant_id AND v.id=r.template_version_id WHERE r.tenant_id=$1 AND r.domain_event=$2 AND r.status='ACTIVE' AND (r.branch_id IS NULL OR r.branch_id=$3) ORDER BY r.branch_id NULLS LAST LIMIT 1`,
          [event.tenant_id, event.event_type, event.branch_id],
        )
      ).rows[0];
      if (!rule) continue;
      const appointment = event.event_type.startsWith("appointment.")
        ? (
            await this.pool.query<any>(
              `SELECT a.*,c.id customer_id,c.display_name,p.email_address,p.email_status,p.preferred_locale,p.preferred_timezone FROM appointments a JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id WHERE a.tenant_id=$1 AND a.id=$2`,
              [event.tenant_id, event.aggregate_id],
            )
          ).rows[0]
        : null;
      if (event.event_type.startsWith("appointment.") && !appointment) continue;
      const customerId =
        appointment?.customer_id ?? event.payload_json?.customerId;
      const preference =
        appointment ??
        (
          await this.pool.query<any>(
            "SELECT * FROM customer_communication_preferences WHERE tenant_id=$1 AND customer_id=$2",
            [event.tenant_id, customerId],
          )
        ).rows[0];
      if (!preference) continue;
      const status = [
        "BOUNCED",
        "COMPLAINED",
        "INVALID",
        "SUPPRESSED",
      ].includes(preference.email_status)
        ? "SUPPRESSED"
        : "SCHEDULED";
      const variables = {
        customerName: appointment?.display_name ?? "Customer",
        appointmentStart: appointment?.start_at ?? "",
        bookingReference: appointment?.booking_reference ?? "",
        action: event.event_type,
      };
      const result = await this.pool.query(
        `INSERT INTO communication_messages(tenant_id,branch_id,customer_id,category,purpose,template_version_id,generation_key,recipient_hash,recipient_reference,locale,timezone,variables_json,status,scheduled_at,appointment_id,suppression_reason) VALUES($1,$2,$3,'TRANSACTIONAL',$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+($13||' seconds')::interval,$14,$15) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
        [
          event.tenant_id,
          event.branch_id,
          customerId,
          rule.purpose,
          rule.template_version_id,
          `event:${event.id}`,
          preference.email_address ? this.hash(preference.email_address) : null,
          `preference:${customerId}`,
          preference.preferred_locale ?? rule.locale,
          preference.preferred_timezone ?? "Asia/Ho_Chi_Minh",
          JSON.stringify(variables),
          status,
          rule.delay_seconds,
          appointment?.id ?? null,
          status === "SUPPRESSED" ? preference.email_status : null,
        ],
      );
      count += result.rowCount ?? 0;
      if (
        event.event_type === "appointment.rescheduled" ||
        event.event_type === "appointment.cancelled"
      )
        await this.pool.query(
          `UPDATE communication_messages SET status='CANCELLED',suppression_reason='APPOINTMENT_CHANGED',updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2 AND purpose='APPOINTMENT_REMINDER' AND status IN('PENDING','SCHEDULED') AND generation_key<>$3`,
          [event.tenant_id, event.aggregate_id, `event:${event.id}`],
        );
    }
    return count;
  }
  async scheduleReminders() {
    const result = await this.pool
      .query(`INSERT INTO communication_messages(tenant_id,branch_id,customer_id,category,purpose,template_version_id,generation_key,recipient_hash,recipient_reference,locale,timezone,variables_json,status,scheduled_at,appointment_id)
      SELECT a.tenant_id,a.branch_id,a.customer_id,'TRANSACTIONAL','APPOINTMENT_REMINDER',r.template_version_id,'reminder:'||a.id||':policy:1',encode(digest(p.email_address,'sha256'),'hex'),'preference:'||a.customer_id,p.preferred_locale,p.preferred_timezone,jsonb_build_object('customerName',c.display_name,'appointmentStart',a.start_at,'bookingReference',a.booking_reference),'SCHEDULED',a.start_at-(s.reminder_lead_minutes||' minutes')::interval,a.id
      FROM appointments a JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id JOIN customer_communication_preferences p ON p.tenant_id=a.tenant_id AND p.customer_id=a.customer_id JOIN communication_settings s ON s.tenant_id=a.tenant_id JOIN communication_rules r ON r.tenant_id=a.tenant_id AND r.domain_event='appointment.reminder' AND r.status='ACTIVE' AND (r.branch_id IS NULL OR r.branch_id=a.branch_id)
      WHERE a.status IN('CONFIRMED','CHECKED_IN') AND a.start_at>now() AND a.start_at<now()+interval '8 days' AND p.email_status NOT IN('BOUNCED','COMPLAINED','INVALID','SUPPRESSED') AND p.email_address IS NOT NULL ON CONFLICT(tenant_id,generation_key) DO NOTHING`);
    return result.rowCount ?? 0;
  }
  async startCampaigns() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const campaigns = (
        await client.query<any>(
          `SELECT * FROM marketing_campaigns WHERE status='SCHEDULED' AND scheduled_at<=now() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 20`,
        )
      ).rows;
      let count = 0;
      for (const campaign of campaigns) {
        await client.query(
          "UPDATE marketing_campaigns SET status='RUNNING',started_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [campaign.tenant_id, campaign.id],
        );
        const inserted = await client.query(
          `INSERT INTO communication_messages(tenant_id,branch_id,customer_id,category,purpose,template_version_id,generation_key,recipient_hash,recipient_reference,locale,timezone,status,scheduled_at,marketing_campaign_id) SELECT tenant_id,$3,customer_id,'MARKETING',$4,$5,'campaign:'||campaign_id||':'||generation||':'||customer_id,contact_hash,contact_reference,locale,timezone,'SCHEDULED',now(),campaign_id FROM marketing_campaign_audience WHERE tenant_id=$1 AND campaign_id=$2 AND generation=$6 AND status='ELIGIBLE' ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            campaign.tenant_id,
            campaign.id,
            campaign.branch_id,
            campaign.campaign_type,
            campaign.template_version_id,
            campaign.audience_generation,
          ],
        );
        count += inserted.rowCount ?? 0;
      }
      await client.query("COMMIT");
      return count;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async scheduleReviewRequests() {
    const rows = (
      await this.pool.query<any>(
        `SELECT i.tenant_id,i.id invoice_id,i.branch_id,o.appointment_id,o.customer_id,p.email_address,p.preferred_locale,p.preferred_timezone,c.display_name FROM invoices i JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id JOIN customers c ON c.tenant_id=o.tenant_id AND c.id=o.customer_id JOIN customer_communication_preferences p ON p.tenant_id=o.tenant_id AND p.customer_id=o.customer_id WHERE i.status='ISSUED' AND i.paid_minor>=i.total_minor+i.tip_minor AND o.status='PAID' AND a.status='COMPLETED' AND p.email_status='VERIFIED' AND p.review_request_allowed AND NOT EXISTS(SELECT 1 FROM review_requests rr WHERE rr.tenant_id=i.tenant_id AND rr.appointment_id=o.appointment_id) ORDER BY i.issued_at LIMIT 50`,
      )
    ).rows;
    let count = 0;
    for (const row of rows) {
      const version = (
        await this.pool.query<any>(
          `SELECT v.* FROM communication_template_versions v JOIN communication_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id WHERE v.tenant_id=$1 AND t.code='REVIEW_REQUEST' AND v.locale=$2 AND v.status='ACTIVE' LIMIT 1`,
          [row.tenant_id, row.preferred_locale],
        )
      ).rows[0];
      if (!version) continue;
      const id = randomUUID();
      const expires = new Date(Date.now() + 14 * 86400_000);
      const token = this.sign({
        tenantId: row.tenant_id,
        reviewRequestId: id,
        customerId: row.customer_id,
        purpose: "REVIEW",
        exp: Math.floor(expires.getTime() / 1000),
      });
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9) ON CONFLICT DO NOTHING`,
          [
            id,
            row.tenant_id,
            row.branch_id,
            row.customer_id,
            row.appointment_id,
            row.invoice_id,
            this.hash(token),
            expires,
            `review:${row.appointment_id}`,
          ],
        );
        const inserted = await client.query(
          `INSERT INTO communication_messages(tenant_id,branch_id,customer_id,category,purpose,template_version_id,generation_key,recipient_hash,recipient_reference,locale,timezone,variables_json,status,scheduled_at,review_request_id) VALUES($1,$2,$3,'ENGAGEMENT','REVIEW_REQUEST',$4,$5,$6,$7,$8,$9,$10,'SCHEDULED',now(),$11) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            row.tenant_id,
            row.branch_id,
            row.customer_id,
            version.id,
            `review-message:${row.appointment_id}`,
            this.hash(row.email_address),
            `preference:${row.customer_id}`,
            row.preferred_locale,
            row.preferred_timezone,
            JSON.stringify({
              customerName: row.display_name,
              reviewUrl: `/public/review?token=${token}`,
            }),
            id,
          ],
        );
        await client.query("COMMIT");
        count += inserted.rowCount ?? 0;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return count;
  }
  async expireReviewRequests() {
    const result = await this.pool.query(
      "UPDATE review_requests SET status='EXPIRED' WHERE status IN('PENDING','SENT') AND expires_at<=now()",
    );
    return result.rowCount ?? 0;
  }
  async warnRecoverySla() {
    const result = await this.pool.query(
      `INSERT INTO internal_notifications(tenant_id,branch_id,recipient_user_id,type,title,body_redacted,entity_type,entity_id) SELECT c.tenant_id,c.branch_id,c.assigned_user_id,'RECOVERY_SLA_WARNING','Recovery SLA warning','A recovery case is approaching SLA','service_recovery_case',c.id FROM service_recovery_cases c WHERE c.status NOT IN('RESOLVED','CLOSED','CANCELLED') AND c.first_response_due_at<=now()+interval '30 minutes' AND NOT EXISTS(SELECT 1 FROM internal_notifications n WHERE n.tenant_id=c.tenant_id AND n.entity_id=c.id AND n.type='RECOVERY_SLA_WARNING')`,
    );
    return result.rowCount ?? 0;
  }
  async deliverOne() {
    const client = await this.pool.connect();
    let message: any;
    try {
      await client.query("BEGIN");
      message = (
        await client.query<any>(
          `SELECT m.*,s.email_provider_mode,s.delivery_max_attempts,s.marketing_frequency_limit,s.marketing_frequency_window_days,s.quiet_hours_start,s.quiet_hours_end,p.email_address,p.email_status,p.marketing_email_allowed,p.review_request_allowed,v.subject,v.html_body,v.plain_text_body,v.allowed_variables_json,v.required_variables_json FROM communication_messages m JOIN communication_settings s ON s.tenant_id=m.tenant_id JOIN customer_communication_preferences p ON p.tenant_id=m.tenant_id AND p.customer_id=m.customer_id LEFT JOIN communication_template_versions v ON v.tenant_id=m.tenant_id AND v.id=m.template_version_id WHERE m.status IN('PENDING','SCHEDULED','FAILED') AND COALESCE(m.next_attempt_at,m.scheduled_at,m.created_at)<=now() ORDER BY COALESCE(m.next_attempt_at,m.scheduled_at,m.created_at),m.id FOR UPDATE OF m SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!message) {
        await client.query("COMMIT");
        return 0;
      }
      if (message.appointment_id) {
        const appointment = (
          await client.query<any>(
            "SELECT status,start_at FROM appointments WHERE tenant_id=$1 AND id=$2",
            [message.tenant_id, message.appointment_id],
          )
        ).rows[0];
        if (
          !appointment ||
          ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SALON"].includes(
            appointment.status,
          ) ||
          (message.purpose === "APPOINTMENT_REMINDER" &&
            new Date(appointment.start_at) <= new Date())
        ) {
          await client.query(
            "UPDATE communication_messages SET status='CANCELLED',suppression_reason='APPOINTMENT_NOT_ELIGIBLE',updated_at=now() WHERE id=$1",
            [message.id],
          );
          await client.query("COMMIT");
          return 1;
        }
      }
      if (
        ["BOUNCED", "COMPLAINED", "INVALID", "SUPPRESSED"].includes(
          message.email_status,
        ) ||
        !message.email_address
      ) {
        await this.suppress(
          client,
          message,
          message.email_status || "INVALID_ADDRESS",
        );
        await client.query("COMMIT");
        return 1;
      }
      if (message.category === "MARKETING") {
        const consent = (
          await client.query<any>(
            "SELECT state FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2 AND purpose='MARKETING_EMAIL'",
            [message.tenant_id, message.customer_id],
          )
        ).rows[0];
        const suppression = await client.query(
          "SELECT 1 FROM communication_suppressions WHERE tenant_id=$1 AND customer_id=$2 AND active AND (purpose IS NULL OR purpose='MARKETING_EMAIL')",
          [message.tenant_id, message.customer_id],
        );
        if (
          consent?.state !== "GRANTED" ||
          !message.marketing_email_allowed ||
          suppression.rowCount
        ) {
          await this.suppress(client, message, "CONSENT_OR_SUPPRESSION");
          await client.query("COMMIT");
          return 1;
        }
        const count = Number(
          (
            await client.query<any>(
              `SELECT count(*) n FROM communication_messages WHERE tenant_id=$1 AND customer_id=$2 AND category='MARKETING' AND status IN('SENT','DELIVERED') AND sent_at>=now()-($3||' days')::interval`,
              [
                message.tenant_id,
                message.customer_id,
                message.marketing_frequency_window_days,
              ],
            )
          ).rows[0].n,
        );
        if (count >= message.marketing_frequency_limit) {
          await this.suppress(client, message, "FREQUENCY_CAP");
          await client.query("COMMIT");
          return 1;
        }
        const localHour = Number(
          (
            await client.query<any>(
              "SELECT extract(hour FROM now() AT TIME ZONE $1)::int hour",
              [message.timezone],
            )
          ).rows[0].hour,
        );
        const start = Number(String(message.quiet_hours_start).slice(0, 2)),
          end = Number(String(message.quiet_hours_end).slice(0, 2));
        if (
          (start > end && (localHour >= start || localHour < end)) ||
          (start <= end && localHour >= start && localHour < end)
        ) {
          await client.query(
            "UPDATE communication_messages SET status='SCHEDULED',next_attempt_at=now()+interval '1 hour',safe_error_code='QUIET_HOURS',updated_at=now() WHERE id=$1",
            [message.id],
          );
          await client.query("COMMIT");
          return 1;
        }
      }
      const rendered = this.render(message);
      await client.query(
        "UPDATE communication_messages SET status='PROCESSING',processing_started_at=now(),rendered_subject=$2,rendered_html=$3,rendered_text=$4,attempt_count=attempt_count+1,updated_at=now() WHERE id=$1",
        [message.id, rendered.subject, rendered.html, rendered.text],
      );
      await client.query("COMMIT");
      message = {
        ...message,
        ...rendered,
        attempt_count: message.attempt_count + 1,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    try {
      const result = await this.provider.sendEmail(
        message.email_provider_mode,
        {
          messageId: message.id,
          recipient: message.email_address,
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
      );
      const done = await this.pool.connect();
      try {
        await done.query("BEGIN");
        await done.query(
          "INSERT INTO communication_delivery_attempts(tenant_id,message_id,attempt_number,provider_reference,result,redacted_metadata_json) VALUES($1,$2,$3,$4,'SENT','{}')",
          [
            message.tenant_id,
            message.id,
            message.attempt_count,
            result.providerReference,
          ],
        );
        await done.query(
          "UPDATE communication_messages SET status='SENT',sent_at=now(),safe_error_code=NULL,updated_at=now() WHERE id=$1",
          [message.id],
        );
        if (message.review_request_id)
          await done.query(
            "UPDATE review_requests SET status='SENT',sent_at=now() WHERE tenant_id=$1 AND id=$2",
            [message.tenant_id, message.review_request_id],
          );
        if (message.marketing_campaign_id)
          await done.query(
            "UPDATE marketing_campaign_audience SET status='SENT' WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3",
            [
              message.tenant_id,
              message.marketing_campaign_id,
              message.customer_id,
            ],
          );
        await done.query("COMMIT");
      } catch (error) {
        await done.query("ROLLBACK");
        throw error;
      } finally {
        done.release();
      }
    } catch (error: any) {
      const safe = String(error?.code ?? "EMAIL_PROVIDER_FAILURE").slice(
        0,
        100,
      );
      const terminal =
        message.attempt_count >= message.delivery_max_attempts ||
        error?.retryable === false;
      await this.pool.query(
        `WITH attempt AS (INSERT INTO communication_delivery_attempts(tenant_id,message_id,attempt_number,result,safe_error_code,redacted_metadata_json) VALUES($1,$2,$3,'FAILED',$4,'{}') ON CONFLICT DO NOTHING) UPDATE communication_messages SET status=$5,safe_error_code=$4,next_attempt_at=CASE WHEN $5='FAILED' THEN now()+make_interval(secs=>least(3600,power(2,$3)::int*30)) ELSE NULL END,updated_at=now() WHERE id=$2`,
        [
          message.tenant_id,
          message.id,
          message.attempt_count,
          safe,
          terminal ? "DEAD_LETTER" : "FAILED",
        ],
      );
    }
    return 1;
  }
  private render(message: any) {
    const allowed = message.allowed_variables_json ?? [],
      required = message.required_variables_json ?? [],
      variables = message.variables_json ?? {};
    const render = (source: string) =>
      String(source ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/{{\s*([a-zA-Z][\w.]*)\s*}}/g, (_: string, key: string) => {
          if (!allowed.includes(key))
            throw Object.assign(new Error("FAILED_RENDER"), {
              code: "FAILED_RENDER",
              retryable: false,
            });
          if (required.includes(key) && variables[key] == null)
            throw Object.assign(new Error("FAILED_RENDER"), {
              code: "FAILED_RENDER",
              retryable: false,
            });
          return String(variables[key] ?? "").replace(
            /[&<>"']/g,
            (x) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[x]!,
          );
        });
    return {
      subject: render(message.subject),
      html: render(message.html_body),
      text: render(message.plain_text_body),
    };
  }
  private async suppress(client: any, message: any, reason: string) {
    await client.query(
      "UPDATE communication_messages SET status='SUPPRESSED',suppression_reason=$2,updated_at=now() WHERE id=$1",
      [message.id, reason],
    );
    if (message.marketing_campaign_id)
      await client.query(
        "UPDATE marketing_campaign_audience SET status='SUPPRESSED',skipped_reason=$4 WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3",
        [
          message.tenant_id,
          message.marketing_campaign_id,
          message.customer_id,
          reason,
        ],
      );
  }
  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  private sign(payload: any) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const configuredSecret =
      process.env.COMMUNICATION_TOKEN_SECRET ?? process.env.JWT_SECRET;
    if (!configuredSecret && process.env.NODE_ENV === "production")
      throw new Error("COMMUNICATION_TOKEN_SECRET_REQUIRED");
    const secret = configuredSecret ?? "development-only-communication-secret";
    return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
