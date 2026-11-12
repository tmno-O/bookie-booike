import type { ISql } from "postgres";
import type { z } from "zod";
import type { staffQueueQuery, staffQueueRow } from "@/contracts/queue";
import { bucketForPartySize } from "@/contracts/party";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { bangkokDate } from "@/lib/service-date";
import { zoneAvailability } from "./availability";

type QueueRow = Omit<z.infer<typeof staffQueueRow>, "party" | "requestedAt" | "queueNo"> & {
  partySize: number; requestedAt: Date; queueNo: string; phone: string;
};

function queueFields(sql: ISql) {
  return sql`
    select b.id, r.queue_no, r.created_at as requested_at, b.contact_name as name,
      coalesce(b.contact_phone, '') as phone, to_char(b.service_date, 'YYYY-MM-DD') as service_date,
      b.party_size, b.zone_id, z.name as zone_name,
      case when b.status = 'pending_allocation' then 'pending' else 'allocated' end as status
    from bookings b join booking_requests r on r.venue_id = b.venue_id and r.id = b.request_id
    join zones z on z.venue_id = b.venue_id and z.id = b.zone_id
  `;
}

function queueView(row: QueueRow) {
  const { id, name, serviceDate, zoneId, zoneName, status, requestedAt, queueNo, partySize } = row;
  return { id, name, serviceDate, zoneId, zoneName, status, requestedAt,
    queueNo: Number(queueNo), party: bucketForPartySize(partySize) };
}

export async function listStaffQueue(venueId: string, query: z.infer<typeof staffQueueQuery>) {
  const today = bangkokDate();
  const serviceDate = query.date ?? today;
  const sql = db();
  const rows = await sql<QueueRow[]>`
    ${queueFields(sql)}
    where b.venue_id = ${venueId} and b.service_date = ${serviceDate}
      and b.status <> 'cancelled' and r.queue_no is not null
    order by r.queue_no
  `;
  return {
    serviceDate, today, pending: rows.filter((row) => row.status === "pending").length,
    requests: rows.filter((row) => query.status === "all" || row.status === query.status).map(queueView),
  };
}

async function readQueueRow(sql: ISql, venueId: string, bookingId: string) {
  const [row] = await sql<QueueRow[]>`
    ${queueFields(sql)}
    where b.venue_id = ${venueId} and b.id = ${bookingId} and b.status <> 'cancelled' and r.queue_no is not null
  `;
  return row ?? notFound("Queue booking");
}

export function getStaffQueueItem(venueId: string, bookingId: string) {
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const row = await readQueueRow(tx, venueId, bookingId);
    const zones = await zoneAvailability(tx, venueId, row.serviceDate, row.partySize, { skipRelease: true });
    return { request: queueView(row), phone: row.phone, zones };
  });
}

const failures = {
  ALREADY_ALLOCATED: "คำขอนี้ได้รับการจัดสรรแล้วหรือถูกยกเลิก",
  ZONE_NOT_FOUND: "ไม่พบโซน",
  ZONE_CLOSED: "โซนนี้ปิดรับจอง",
  ZONE_FULL: "โซนนี้เต็มแล้ว",
};

export function allocateBooking(staff: Staff, bookingId: string, zoneId?: string) {
  return db().begin(async (tx) => {
    const [result] = await tx<{
      code: keyof typeof failures | "NOT_FOUND" | "ALLOCATED";
    }[]>`select allocate_booking(${staff.venueId}, ${bookingId}, ${staff.userId}, ${zoneId ?? null}) as code`;
    if (result.code === "NOT_FOUND") notFound("Queue booking");
    if (result.code !== "ALLOCATED") throw new ApiError(result.code === "ZONE_NOT_FOUND" ? 422 : 409, result.code, failures[result.code]);
    return { request: queueView(await readQueueRow(tx, staff.venueId, bookingId)) };
  });
}
