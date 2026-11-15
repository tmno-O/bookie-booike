import { db } from "@/lib/db";
import { sendLinePush, type LineRecipient } from "@/server/line-push";

type AnnouncementJob = LineRecipient & { title: string; serviceDate: string; opensAt: Date;
  liffId: string | null; attempts: number; obsolete: boolean; optedOut: boolean };

export async function deliverNextAnnouncement(send: typeof fetch = fetch, venueId?: string) {
  return db().begin(async (tx) => {
    const venue = venueId ? tx`and o.venue_id = ${venueId}` : tx``;
    const [job] = await tx<AnnouncementJob[]>`
      select o.id, o.venue_id, o.attempts, a.title, to_char(a.service_date, 'YYYY-MM-DD') as service_date,
        a.opens_at, l.liff_id, l.access_token_ciphertext, i.subject, c.announcements_opt_out as opted_out,
        o.created_at < now() - interval '23 hours' as stale,
        (r.venue_id is null or r.opens_at <> a.opens_at or not service_night_open(a.venue_id, a.service_date)
          or now() >= announcement_expires_at(a.venue_id, a.service_date)) as obsolete
      from announcement_outbox o join release_announcements a on a.id = o.announcement_id
      join venue_customers c on c.venue_id = o.venue_id and c.customer_id = o.customer_id
      left join booking_releases r on r.venue_id = a.venue_id and r.service_date = a.service_date
      left join venue_line_integrations l on l.venue_id = o.venue_id
      left join lateral (select subject from customer_identities where provider_id = l.provider_id
        and customer_id = o.customer_id order by subject limit 1) i on true
      where o.status = 'pending' and o.next_attempt_at <= now() ${venue}
      order by o.next_attempt_at, o.created_at, o.id limit 1 for update of o skip locked
    `;
    if (!job) return false;
    const contents: object[] = [
      { type: "text", text: `รอบใหม่: ${job.title}`, weight: "bold", size: "lg", wrap: true },
      { type: "text", text: `คืนบริการ ${job.serviceDate}`, wrap: true },
      { type: "text", text: `เปิดจอง ${new Intl.DateTimeFormat("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(job.opensAt)} น.`, wrap: true },
    ];
    if (job.liffId) contents.push({ type: "button", action: { type: "uri", label: "ดูรอบจอง", uri: `https://liff.line.me/${job.liffId}?next=waiting` } });
    const result = job.optedOut || job.obsolete
      ? { status: "skipped", error: job.optedOut ? "OPTED_OUT" : "RELEASE_UNAVAILABLE" }
      : await sendLinePush(job, [{ type: "flex", altText: `รอบใหม่: ${job.title}`,
        contents: { type: "bubble", body: { type: "box", layout: "vertical", contents } } }], send);
    const attempts = job.attempts + 1;
    const status = result.status === "retry" ? (attempts < 5 ? "pending" : "dead") : result.status;
    await tx`update announcement_outbox set status = ${status}, attempts = ${attempts},
      next_attempt_at = clock_timestamp() + ${30 * 2 ** job.attempts} * interval '1 second', last_error = ${result.error} where id = ${job.id}`;
    return true;
  });
}
