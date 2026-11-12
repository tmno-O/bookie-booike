import type { Sql } from "postgres";
import { z } from "zod";
import { bookingStatus } from "@/contracts/booking";
import { serviceDate } from "@/contracts/common";
import { bucketForPartySize } from "@/contracts/party";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { input } from "@/lib/http";

type Access = { venueId: string; customerId?: string };
type BookingRow = {
  id: string; venueId: string; customerId: string; tableId: string | null; zoneId: string; zoneName: string;
  serviceDate: string; serviceAt: Date; partySize: number; status: z.infer<typeof bookingStatus>;
  createdAt: Date; cancelledAt: Date | null; checkedInAt: Date | null;
  reference: string; name: string; phone: string; source: "liff" | "staff_assisted";
};

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
  date: serviceDate.optional(),
});

function bookingFields(sql: Sql) {
  return sql`select b.id, b.venue_id, b.customer_id, b.table_id, b.zone_id, z.name as zone_name,
    to_char(b.service_date, 'YYYY-MM-DD') as service_date, b.service_at, b.party_size, b.status,
    b.created_at, b.cancelled_at, b.checked_in_at, b.reference, b.contact_name as name,
    coalesce(b.contact_phone, '') as phone, b.source
    from bookings b join zones z on z.venue_id = b.venue_id and z.id = b.zone_id`;
}

function bookingView(row: BookingRow) {
  return { ...row, party: bucketForPartySize(row.partySize) };
}

export async function listBookings(access: Access, request: Request) {
  const { limit, offset, date } = input(listQuery, Object.fromEntries(new URL(request.url).searchParams));
  const sql = db();
  const ownership = access.customerId ? sql`and b.customer_id = ${access.customerId}` : sql``;
  const service = date ? sql`and b.service_date = ${date}` : sql``;
  const rows = await sql<BookingRow[]>`
    ${bookingFields(sql)}
    where b.venue_id = ${access.venueId} ${ownership} ${service}
    order by b.created_at desc, b.id desc limit ${limit + 1} offset ${offset}
  `;
  return { bookings: rows.slice(0, limit).map(bookingView), nextOffset: rows.length > limit ? offset + limit : null };
}

export async function getBooking(access: Access, id: string) {
  const sql = db();
  const ownership = access.customerId ? sql`and b.customer_id = ${access.customerId}` : sql``;
  const [booking] = await sql<BookingRow[]>`
    ${bookingFields(sql)}
    where b.venue_id = ${access.venueId} and b.id = ${id} ${ownership}
  `;
  return booking ? bookingView(booking) : notFound("Booking");
}
