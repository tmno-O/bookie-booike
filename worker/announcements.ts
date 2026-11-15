import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { MULTICAST_LIMIT, sendLineMulticast } from "@/server/line-push";

const maxAttempts = 5;
const leaseSeconds = 60;

type Row = {
  id: string; venueId: string; announcementId: string; batchId: string | null; attempts: number;
  title: string; serviceDate: string; opensAt: Date; liffId: string | null; accessTokenCiphertext: string | null;
  subject: string | null; optedOut: boolean; stale: boolean; obsolete: boolean;
};

type Batch = {
  batchId: string; venueId: string; accessTokenCiphertext: string | null; subjects: string[];
  title: string; serviceDate: string; opensAt: Date; liffId: string | null;
};

function skipReason(row: Row): { status: "skipped" | "dead"; error: string } | null {
  if (row.optedOut) return { status: "skipped", error: "OPTED_OUT" };
  if (row.obsolete) return { status: "skipped", error: "RELEASE_UNAVAILABLE" };
  if (!row.accessTokenCiphertext || !row.subject) return { status: "skipped", error: "LINE_PUSH_NOT_CONFIGURED" };
  if (row.stale) return { status: "dead", error: "DELIVERY_WINDOW_EXPIRED" };
  return null;
}

/**
 * Leases up to 500 due recipients of one announcement in a short transaction. A batch that failed or whose
 * lease expired is retried with the same members and the same id, which LINE treats as the retry key.
 */
async function claimBatch(venueId?: string): Promise<Batch | "skipped-only" | null> {
  return db().begin(async (tx) => {
    const venue = venueId ? tx`and o.venue_id = ${venueId}` : tx``;
    const [head] = await tx<{ announcementId: string; batchId: string | null }[]>`
      select o.announcement_id, o.batch_id from announcement_outbox o
      where ((o.status = 'pending' and o.next_attempt_at <= now()) or (o.status = 'sending' and o.lease_until <= now())) ${venue}
      order by o.next_attempt_at, o.created_at, o.id limit 1 for update of o skip locked
    `;
    if (!head) return null;
    const members = head.batchId
      ? tx`o.batch_id = ${head.batchId} and o.status in ('pending', 'sending')`
      : tx`o.announcement_id = ${head.announcementId} and o.batch_id is null and o.status = 'pending' and o.next_attempt_at <= now()`;
    const rows = await tx<Row[]>`
      select o.id, o.venue_id, o.announcement_id, o.batch_id, o.attempts, a.title,
        to_char(a.service_date, 'YYYY-MM-DD') as service_date, a.opens_at, l.liff_id, l.access_token_ciphertext,
        i.subject, c.announcements_opt_out as opted_out, o.created_at < now() - interval '23 hours' as stale,
        (r.venue_id is null or r.opens_at <> a.opens_at or not service_night_open(a.venue_id, a.service_date)
          or now() >= announcement_expires_at(a.venue_id, a.service_date)) as obsolete
      from announcement_outbox o join release_announcements a on a.id = o.announcement_id
      join venue_customers c on c.venue_id = o.venue_id and c.customer_id = o.customer_id
      left join booking_releases r on r.venue_id = a.venue_id and r.service_date = a.service_date
      left join venue_line_integrations l on l.venue_id = o.venue_id
      left join lateral (select subject from customer_identities where provider_id = l.provider_id
        and customer_id = o.customer_id order by subject limit 1) i on true
      where ${members}
      order by o.id limit ${MULTICAST_LIMIT} for update of o skip locked
    `;
    if (!rows.length) return null;

    const sendable: Row[] = [];
    for (const row of rows) {
      const skip = skipReason(row);
      if (!skip) { sendable.push(row); continue; }
      await tx`update announcement_outbox set status = ${skip.status}, attempts = attempts + 1, last_error = ${skip.error},
        lease_until = null where id = ${row.id}`;
    }
    if (!sendable.length) return "skipped-only";

    const batchId = head.batchId ?? randomUUID();
    await tx`update announcement_outbox set status = 'sending', batch_id = ${batchId}, attempts = attempts + 1,
      lease_until = clock_timestamp() + ${leaseSeconds} * interval '1 second'
      where id in ${tx(sendable.map((row) => row.id))}`;
    const [first] = sendable;
    return {
      batchId, venueId: first.venueId, accessTokenCiphertext: first.accessTokenCiphertext,
      subjects: [...new Set(sendable.map((row) => row.subject!))],
      title: first.title, serviceDate: first.serviceDate, opensAt: first.opensAt, liffId: first.liffId,
    };
  });
}

function message(batch: Batch) {
  const opens = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })
    .format(batch.opensAt);
  const contents: object[] = [
    { type: "text", text: `รอบใหม่: ${batch.title}`, weight: "bold", size: "lg", wrap: true },
    { type: "text", text: `คืนบริการ ${batch.serviceDate}`, wrap: true },
    { type: "text", text: `เปิดจอง ${opens} น.`, wrap: true },
  ];
  if (batch.liffId) contents.push({ type: "button", action: { type: "uri", label: "ดูรอบจอง", uri: `https://liff.line.me/${batch.liffId}?next=waiting` } });
  return { type: "flex", altText: `รอบใหม่: ${batch.title}`, contents: { type: "bubble", body: { type: "box", layout: "vertical", contents } } };
}

/** Sends one multicast batch. The LINE call happens outside any database transaction. */
export async function deliverNextAnnouncement(send: typeof fetch = fetch, venueId?: string) {
  const batch = await claimBatch(venueId);
  if (!batch) return false;
  if (batch === "skipped-only") return true;

  const result = await sendLineMulticast(
    { retryKey: batch.batchId, venueId: batch.venueId, accessTokenCiphertext: batch.accessTokenCiphertext },
    batch.subjects, [message(batch)], send,
  );
  await db()`
    update announcement_outbox set
      status = case when ${result.status} = 'retry' then case when attempts < ${maxAttempts} then 'pending' else 'dead' end
        else ${result.status} end,
      next_attempt_at = clock_timestamp() + 30 * power(2, greatest(attempts - 1, 0)) * interval '1 second',
      last_error = ${result.error}, lease_until = null
    where batch_id = ${batch.batchId} and status = 'sending'
  `;
  if (result.status === "dead") console.error("LINE announcement batch failed permanently", batch.batchId, result.error);
  return true;
}
