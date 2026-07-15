import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { OutboxRepository } from "./outbox.repository.js";
import type { OutboxEvent } from "./outbox.types.js";

const notificationEvents = new Set([
  "appointment.confirmed",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.pending_confirmation",
  "appointment.deposit_required",
]);

@Injectable()
export class BookingNotificationRouter {
  constructor(
    @Inject(OutboxRepository) private readonly repo: OutboxRepository,
  ) {}
  async route(event: OutboxEvent) {
    if (!notificationEvents.has(event.event_type) || !event.branch_id) return;
    const appointment = (
      await this.repo.query<{ contact_snapshot_json: Record<string, unknown> }>(
        "SELECT contact_snapshot_json FROM appointments WHERE tenant_id=$1 AND id=$2",
        [event.tenant_id, event.aggregate_id],
      )
    ).rows[0];
    if (!appointment) return;
    const destination = String(
      appointment.contact_snapshot_json.phone ??
        appointment.contact_snapshot_json.email ??
        "",
    );
    const destinationHash = destination
      ? createHash("sha256").update(destination.toLowerCase()).digest("hex")
      : null;
    await this.repo.query(
      "INSERT INTO booking_notification_jobs(tenant_id,branch_id,appointment_id,event_id,notification_type,channel,destination_hash,payload_json) VALUES($1,$2,$3,$4,$5,'IN_APP',$6,$7) ON CONFLICT(event_id,notification_type,channel) DO NOTHING",
      [
        event.tenant_id,
        event.branch_id,
        event.aggregate_id,
        event.id,
        event.event_type,
        destinationHash,
        JSON.stringify({
          appointmentId: event.aggregate_id,
          eventType: event.event_type,
        }),
      ],
    );
  }
}
