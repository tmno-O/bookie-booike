import { z } from "zod";
import { serviceDate } from "@/contracts/common";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { input } from "@/lib/http";

type Access = { venueId: string; customerId?: string };

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
  date: serviceDate.optional(),
});

export async function listBookings(access: Access, request: Request) {
  const { limit, offset, date } = input(listQuery, Object.fromEntries(new URL(request.url).searchParams));
  const sql = db();
  const ownership = access.customerId ? sql`and customer_id = ${access.customerId}` : sql``;
  const service = date ? sql`and service_date = ${date}` : sql``;
  const rows = await sql`
    select id, venue_id, customer_id, table_id, zone_id, to_char(service_date, 'YYYY-MM-DD') as service_date, service_at, party_size,
      status, created_at, cancelled_at
    from bookings where venue_id = ${access.venueId} ${ownership} ${service}
    order by created_at desc, id desc limit ${limit + 1} offset ${offset}
  `;
  return { bookings: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}

export async function getBooking(access: Access, id: string) {
  const sql = db();
  const ownership = access.customerId ? sql`and customer_id = ${access.customerId}` : sql``;
  const [booking] = await sql`
    select id, venue_id, customer_id, table_id, zone_id, to_char(service_date, 'YYYY-MM-DD') as service_date, service_at, party_size,
      status, created_at, cancelled_at
    from bookings where venue_id = ${access.venueId} and id = ${id} ${ownership}
  `;
  return booking ?? notFound("Booking");
}
