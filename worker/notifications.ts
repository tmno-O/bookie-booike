import { sendLinePush, type Delivery } from "@/server/line-push";
import { db } from "@/lib/db";

const maxAttempts = 5;

type Notification = {
  id: string;
  bookingId: string;
  venueId: string;
  kind: "confirmed" | "cancelled";
  attempts: number;
  subject: string | null;
  accessTokenCiphertext: string | null;
  serviceDate: string;
  bookingStatus: string;
  stale: boolean;
  note: string | null;
};

export async function deliverNextNotification(send: typeof fetch = fetch, venueId?: string) {
  return db().begin(async (tx) => {
    const venue = venueId ? tx`and n.venue_id = ${venueId}` : tx``;
    const [job] = await tx<Notification[]>`
      select n.id, n.booking_id, n.venue_id, n.kind, n.attempts, i.subject, l.access_token_ciphertext,
        to_char(b.service_date, 'YYYY-MM-DD') as service_date, b.status as booking_status,
        n.created_at < now() - interval '23 hours' as stale, n.note
      from notification_outbox n
      join bookings b on b.venue_id = n.venue_id and b.id = n.booking_id
      left join venue_line_integrations l on l.venue_id = n.venue_id
      left join lateral (
        select subject from customer_identities
        where provider_id = l.provider_id and customer_id = b.customer_id order by subject limit 1
      ) i on true
      where n.status = 'pending' and n.next_attempt_at <= now() ${venue}
        and not exists (
          select 1 from notification_outbox prior where prior.booking_id = n.booking_id
            and prior.kind = 'confirmed' and n.kind = 'cancelled' and prior.status = 'pending'
        )
      order by n.next_attempt_at, n.created_at, n.id
      limit 1 for update of n skip locked
    `;
    if (!job) return false;

    const { status, error } = await sendNotification(job, send);
    const attempts = job.attempts + 1;
    const nextStatus = status === "retry" ? (attempts < maxAttempts ? "pending" : "dead") : status;
    await tx`
      update notification_outbox set status = ${nextStatus}, attempts = ${attempts},
        next_attempt_at = now() + ${30 * 2 ** job.attempts} * interval '1 second', last_error = ${error}
      where id = ${job.id}
    `;
    if (nextStatus === "dead") console.error("LINE notification exhausted delivery", job.id, error);
    return true;
  });
}

async function sendNotification(job: Notification, send: typeof fetch): Promise<Delivery> {
  if (job.kind === "confirmed" && job.bookingStatus === "cancelled") {
    return { status: "skipped", error: "BOOKING_ALREADY_CANCELLED" };
  }
  const title = job.kind === "confirmed" ? "ยืนยันการจองแล้ว" : "ยกเลิกการจองแล้ว";
  return sendLinePush(job, [{
        type: "flex",
        altText: title,
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: title, weight: "bold", size: "lg", wrap: true },
              { type: "text", text: `คืนบริการ ${job.serviceDate}`, margin: "md", wrap: true },
              { type: "text", text: `รหัส ${job.bookingId}`, size: "sm", wrap: true },
              ...(job.note ? [{ type: "text", text: job.note, margin: "md", wrap: true }] : []),
            ],
          },
        },
  }], send);
}
