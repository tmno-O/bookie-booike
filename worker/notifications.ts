import { randomUUID } from "node:crypto";
import { sendLinePush, type Delivery, type LineRecipient } from "@/server/line-push";
import { bookingNoticeMessage, notificationOrigin, type BookingNotice } from "@/server/notification-message";
import { db } from "@/lib/db";

const maxAttempts = 5;
const leaseSeconds = 60;

type Notification = BookingNotice & LineRecipient & {
  attempts: number; bookingStatus: string | null; reminderExpired: boolean; reminderChanged: boolean;
};

async function claimNotification(venueId?: string, confirmationBookingId?: string) {
  return db().begin(async (tx) => {
    const venue = venueId ? tx`and n.venue_id = ${venueId}` : tx``;
    // Prior received jobs are now obsolete once the booking is confirmed, even if backed off.
    const confirmation = confirmationBookingId ? tx`and n.booking_id = ${confirmationBookingId}
      and b.status in ('confirmed', 'checked_in') and n.kind in ('received', 'confirmed')` : tx``;
    const obsoleteReceived = confirmationBookingId ? tx`or (n.kind = 'received' and n.status = 'pending')` : tx``;
    const [job] = await tx<Notification[]>`
      select n.id, n.venue_id, n.kind, n.attempts, i.subject, l.access_token_ciphertext, l.liff_id, v.slug, v.name,
        v.address as venue_address,
        to_char(coalesce(b.service_date, r.service_date), 'YYYY-MM-DD') as service_date,
        to_char(coalesce(b.service_at, r.service_at) at time zone v.timezone, 'HH24:MI') as service_time,
        b.status as booking_status, b.reference, coalesce(b.party_size, r.party_size) as party_size,
        z.name as zone_name, r.result_code, n.note,
        (n.kind = 'reminder' and b.service_at <= now()) as reminder_expired,
        (n.kind = 'reminder' and n.reminder_at is distinct from line_reminder_at(b.service_at, v.booking_reminder_hours)) as reminder_changed,
        coalesce(n.reminder_at, n.created_at) < now() - interval '23 hours' as stale
      from notification_outbox n
      join venues v on v.id = n.venue_id
      left join bookings b on b.venue_id = n.venue_id and b.id = n.booking_id
      left join booking_requests r on r.venue_id = n.venue_id and r.id = n.request_id
      left join zones z on z.venue_id = n.venue_id and z.id = coalesce(b.zone_id, r.zone_id)
      left join venue_line_integrations l on l.venue_id = n.venue_id
      left join lateral (
        select subject from customer_identities
        where provider_id = l.provider_id and customer_id = coalesce(b.customer_id, r.customer_id)
        order by subject limit 1
      ) i on true
      where ((n.status in ('pending', 'scheduled') and n.next_attempt_at <= now())
          or (n.status = 'sending' and n.lease_until <= now()) ${obsoleteReceived}) ${venue} ${confirmation}
        and not exists (
          select 1 from notification_outbox prior where prior.booking_id = n.booking_id
            and prior.status in ('pending', 'sending')
            and ((prior.kind = 'received' and n.kind in ('confirmed', 'cancelled'))
              or (prior.kind = 'confirmed' and n.kind = 'cancelled'))
        )
      order by n.next_attempt_at, n.created_at, n.id
      limit 1 for update of n skip locked
    `;
    if (!job) return null;
    if (job.attempts >= maxAttempts) {
      await tx`update notification_outbox set status = 'dead', last_error = 'LEASE_EXHAUSTED',
        lease_until = null, lease_token = null where id = ${job.id}`;
      console.error("LINE notification exhausted delivery", job.id, "LEASE_EXHAUSTED");
      return "exhausted" as const;
    }
    const token = randomUUID();
    await tx`update notification_outbox set status = 'sending', attempts = attempts + 1, lease_token = ${token},
      lease_until = clock_timestamp() + ${leaseSeconds} * interval '1 second' where id = ${job.id}`;
    return { job, token, attempts: job.attempts + 1 };
  });
}

export async function deliverNextNotification(send: typeof fetch = fetch, venueId?: string, confirmationBookingId?: string) {
  const claim = await claimNotification(venueId, confirmationBookingId);
  if (!claim) return false;
  if (claim === "exhausted") return true;

  const { job, token, attempts } = claim;
  let delivery: Delivery;
  try {
    delivery = await sendNotification(job, send);
  } catch {
    delivery = { status: "retry", error: "LINE_DELIVERY_ERROR" };
  }
  const status = delivery.status === "retry" ? (attempts >= maxAttempts ? "dead" : job.kind === "reminder" ? "scheduled" : "pending") : delivery.status;
  // No database transaction is open during the LINE call. A worker with an expired lease cannot overwrite a new claim.
  const updated = await db()`
    update notification_outbox set status = ${status}, next_attempt_at = clock_timestamp() + ${30 * 2 ** (attempts - 1)} * interval '1 second',
      last_error = ${delivery.error}, lease_until = null, lease_token = null
    where id = ${job.id} and status = 'sending' and lease_token = ${token} returning id
  `;
  if (status === "dead" && updated.length) console.error("LINE notification exhausted delivery", job.id, delivery.error);
  return true;
}

async function sendNotification(job: Notification, send: typeof fetch): Promise<Delivery> {
  if (job.kind === "received" && job.bookingStatus !== "pending_allocation") {
    return { status: "skipped", error: "BOOKING_ALREADY_DECIDED" };
  }
  if (job.kind === "confirmed" && job.bookingStatus === "cancelled") {
    return { status: "skipped", error: "BOOKING_ALREADY_CANCELLED" };
  }
  if (job.kind === "reminder") {
    if (job.bookingStatus !== "confirmed") return { status: "skipped", error: "BOOKING_NOT_CONFIRMED" };
    if (job.reminderExpired) return { status: "skipped", error: "REMINDER_WINDOW_PASSED" };
    if (job.reminderChanged) return { status: "skipped", error: "REMINDER_SETTINGS_CHANGED" };
  }
  return sendLinePush(job, [bookingNoticeMessage(job, notificationOrigin())], send);
}
