import { sendLinePush, type Delivery } from "@/server/line-push";
import { db } from "@/lib/db";

const maxAttempts = 5;

const titles = {
  confirmed: "ยืนยันการจองแล้ว",
  cancelled: "ยกเลิกการจองแล้ว",
  reminder: "เตือนก่อนถึงวันจอง",
  rejected: "จองไม่สำเร็จ",
};

const rejectionReasons: Record<string, string> = {
  TABLE_UNAVAILABLE: "โต๊ะที่เลือกไม่ว่าง",
  ZONE_FULL: "โซนที่เลือกเต็มแล้ว",
  ZONE_CLOSED: "โซนที่เลือกปิดรับจอง",
  CLOSED: "ร้านปิดในคืนที่เลือก",
  NIGHT_NOT_OPEN: "คืนที่เลือกยังไม่เปิดจอง",
  SYSTEM_ERROR: "ระบบไม่สามารถยืนยันการจองได้ กรุณาลองใหม่",
};

type Notification = {
  id: string;
  venueId: string;
  kind: keyof typeof titles;
  status: "pending" | "scheduled";
  attempts: number;
  subject: string | null;
  accessTokenCiphertext: string | null;
  serviceDate: string;
  serviceTime: string | null;
  reference: string | null;
  bookingStatus: string | null;
  resultCode: string | null;
  reminderExpired: boolean;
  stale: boolean;
  note: string | null;
};

export async function deliverNextNotification(send: typeof fetch = fetch, venueId?: string) {
  return db().begin(async (tx) => {
    const venue = venueId ? tx`and n.venue_id = ${venueId}` : tx``;
    const [job] = await tx<Notification[]>`
      select n.id, n.venue_id, n.kind, n.status, n.attempts, i.subject, l.access_token_ciphertext,
        to_char(coalesce(b.service_date, r.service_date), 'YYYY-MM-DD') as service_date,
        to_char(b.service_at at time zone 'Asia/Bangkok', 'HH24:MI') as service_time,
        b.status as booking_status, b.reference, r.result_code, n.note,
        (n.kind = 'reminder' and b.service_at <= now()) as reminder_expired,
        coalesce(n.reminder_at, n.created_at) < now() - interval '23 hours' as stale
      from notification_outbox n
      left join bookings b on b.venue_id = n.venue_id and b.id = n.booking_id
      left join booking_requests r on r.venue_id = n.venue_id and r.id = n.request_id
      left join venue_line_integrations l on l.venue_id = n.venue_id
      left join lateral (
        select subject from customer_identities
        where provider_id = l.provider_id and customer_id = coalesce(b.customer_id, r.customer_id)
        order by subject limit 1
      ) i on true
      where n.status in ('pending', 'scheduled') and n.next_attempt_at <= now() ${venue}
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
    const nextStatus = status === "retry" ? (attempts < maxAttempts ? job.status : "dead") : status;
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
  if (job.kind === "reminder" && job.bookingStatus !== "confirmed") {
    return { status: "skipped", error: "BOOKING_NOT_CONFIRMED" };
  }
  if (job.kind === "reminder" && job.reminderExpired) {
    return { status: "skipped", error: "REMINDER_WINDOW_PASSED" };
  }
  const title = titles[job.kind];
  const date = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(job.serviceDate));
  const service = job.kind === "reminder" && job.serviceTime ? `${date} เวลา ${job.serviceTime} น.` : date;
  const detail = job.kind === "rejected"
    ? rejectionReasons[job.resultCode ?? ""] ?? "ไม่สามารถยืนยันการจองรอบนี้ได้ กรุณาลองใหม่"
    : job.note;
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
              { type: "text", text: `คืนบริการ ${service}`, margin: "md", wrap: true },
              ...(job.reference ? [{ type: "text", text: `เลขอ้างอิง ${job.reference}`, size: "sm", wrap: true }] : []),
              ...(detail ? [{ type: "text", text: detail, margin: "md", wrap: true }] : []),
            ],
          },
        },
  }], send);
}
