import type { z } from "zod";
import type { AuditEntry, auditQuery, verifyQuery } from "@/contracts/audit";
import { csvRows } from "@/lib/csv";
import { db } from "@/lib/db";
import { bangkokDate } from "@/lib/service-date";
import { verifyCheckpoints } from "./audit-checkpoints";
import { getBooking } from "./bookings";

async function timelineRows(venueId: string, options: { date?: string; bookingId?: string; q?: string; limit?: number; offset?: number }) {
  const sql = db();
  const date = options.date ? sql`and (r.service_date = ${options.date} or a.details->>'service_date' = ${options.date}
    or a.details->>'serviceDate' = ${options.date}
    or (r.id is null and t.id is not null and (a.created_at at time zone 'Asia/Bangkok')::date = ${options.date}::date))` : sql``;
  const booking = options.bookingId ? sql`and (b.id = ${options.bookingId} or a.entity_id = ${options.bookingId})` : sql``;
  const search = options.q ? sql`and (strpos(lower(b.reference), lower(${options.q})) > 0
    or (${/^\d{4}$/.test(options.q)} and right(coalesce(r.contact_phone, t.contact_phone, ''), 4) = ${options.q}))` : sql``;
  const page = options.limit === undefined ? sql`` : sql`limit ${options.limit} offset ${options.offset ?? 0}`;
  return sql<AuditEntry[]>`
    select a.id::text, a.seq::text, a.action, a.created_at, a.actor_type as actor,
      coalesce(a.details->>'ticket_seq', t.seq::text) as ticket_seq,
      coalesce(a.details->>'queue_seq', r.queue_seq::text) as queue_seq,
      coalesce(a.details->>'received_at', to_char(r.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as received_at,
      coalesce(a.details->>'decided_at', to_char(r.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as decided_at,
      coalesce(a.details->>'result_code', r.result_code) as result_code,
      b.reference, case when coalesce(r.contact_phone, t.contact_phone, '') = '' then ''
        else '***' || right(coalesce(r.contact_phone, t.contact_phone), 4) end as phone,
      coalesce(a.details->>'table_id', b.table_id::text, r.table_id::text) as table_id,
      coalesce(a.details->>'zone_id', b.zone_id::text, r.zone_id::text) as zone_id,
      table_info.name as table_name, zone_info.name as zone_name, encode(a.row_hash, 'hex') as row_hash
    from audit_logs a
    left join bookings entity_booking on entity_booking.venue_id = a.venue_id and entity_booking.id = a.entity_id
    left join booking_requests ticket_request on ticket_request.venue_id = a.venue_id and ticket_request.ticket_id = a.entity_id
    left join booking_requests r on r.venue_id = a.venue_id and r.id = coalesce(
      case when a.details->>'request_id' ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
        then (a.details->>'request_id')::uuid end, entity_booking.request_id, ticket_request.id, a.entity_id)
    left join bookings b on b.venue_id = a.venue_id and b.id = r.booking_id
    left join venue_tables table_info on table_info.venue_id = a.venue_id and table_info.id = coalesce(b.table_id, r.table_id)
    left join zones zone_info on zone_info.venue_id = a.venue_id and zone_info.id = coalesce(b.zone_id, r.zone_id, table_info.zone_id)
    left join queue_tickets t on t.venue_id = a.venue_id and t.id = coalesce(r.ticket_id, a.entity_id)
    where a.venue_id = ${venueId} ${date} ${booking} ${search}
    order by a.seq ${page}
  `;
}

export async function nightTimeline(venueId: string, query: z.infer<typeof auditQuery>) {
  const date = query.date ?? bangkokDate();
  const entries = await timelineRows(venueId, { ...query, date, limit: query.limit + 1 });
  return { date, entries: entries.slice(0, query.limit), nextOffset: entries.length > query.limit ? query.offset + query.limit : null };
}
export async function bookingTimeline(venueId: string, bookingId: string) {
  await getBooking({ venueId }, bookingId);
  return { entries: await timelineRows(venueId, { bookingId }) };
}
export async function verifyChain(venueId: string, range: z.infer<typeof verifyQuery>) {
  const [result] = await db()`select * from verify_audit_chain(${venueId}, ${range.from ?? null}::bigint, ${range.to ?? null}::bigint)`;
  const checkpoints = await verifyCheckpoints(venueId);
  return { ...result, checkpoints, valid: result.firstBadSeq === null && checkpoints.firstInvalidSeq === null };
}
export async function exportAudit(venueId: string, query: z.infer<typeof auditQuery>) {
  const rows = await timelineRows(venueId, { date: query.date ?? bangkokDate(), q: query.q });
  const columns = ["seq", "createdAt", "action", "actor", "reference", "phone", "ticketSeq", "queueSeq", "receivedAt", "decidedAt", "resultCode", "tableId", "tableName", "zoneId", "zoneName", "rowHash"] as const;
  return csvRows([columns.slice(), ...rows.map((row) => columns.map((key) => {
    const value: unknown = row[key]; return value instanceof Date ? value.toISOString() : value;
  }))]);
}
