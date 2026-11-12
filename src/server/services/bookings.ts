import type { ISql } from "postgres";
import type { z } from "zod";
import type { bookingStatus } from "@/contracts/booking";
import { bookingListQuery } from "@/contracts/staff";
import { bucketForPartySize } from "@/contracts/party";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { input } from "@/lib/http";
import { bangkokDate } from "@/lib/service-date";
import { zoneUsage } from "./inventory";

type Access = { venueId: string; customerId?: string };
type BookingRow = {
  id: string; venueId: string; customerId: string; tableId: string | null; zoneId: string; zoneName: string;
  serviceDate: string; serviceAt: Date; partySize: number; status: z.infer<typeof bookingStatus>;
  createdAt: Date; cancelledAt: Date | null; checkedInAt: Date | null;
  reference: string; name: string; phone: string; source: "liff" | "staff_assisted";
};

function bookingFields(sql: ISql) {
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
  const { limit, offset, date, status, zone, q } = input(bookingListQuery, Object.fromEntries(new URL(request.url).searchParams));
  const sql = db();
  const ownership = access.customerId ? sql`and b.customer_id = ${access.customerId}` : sql``;
  const service = date ? sql`and b.service_date = ${date}` : sql``;
  const state = status ? sql`and b.status = ${status === "pending" ? "pending_allocation" : status}` : sql``;
  const area = zone ? sql`and b.zone_id = ${zone}` : sql``;
  const phone = q?.replace(/\s+/g, "");
  const search = q ? sql`and (
    strpos(lower(b.contact_name), lower(${q})) > 0 or strpos(b.contact_phone, ${phone!}) > 0
    or strpos(lower(b.reference), lower(${q})) > 0
  )` : sql``;
  const rows = await sql<BookingRow[]>`
    ${bookingFields(sql)}
    where b.venue_id = ${access.venueId} ${ownership} ${service} ${state} ${area} ${search}
    order by b.created_at desc, b.id desc limit ${limit + 1} offset ${offset}
  `;
  return {
    bookings: rows.slice(0, limit).map(bookingView),
    nextOffset: rows.length > limit ? offset + limit : null,
    ...(!access.customerId && { serviceDate: date ?? bangkokDate() }),
  };
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

export async function getStaffBooking(venueId: string, id: string) {
  const booking = await getBooking({ venueId }, id);
  return { ...booking, canCheckIn: booking.status === "confirmed" && booking.serviceDate === bangkokDate() };
}

export async function staffDashboard(venueId: string, serviceDate: string) {
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const rows = await tx<BookingRow[]>`
      ${bookingFields(tx)}
      where b.venue_id = ${venueId} and b.service_date = ${serviceDate} and b.status <> 'cancelled'
      order by b.created_at desc, b.id desc
    `;
    const [inFlight] = await tx<{ count: number }[]>`
      select ((
        select count(*) from queue_tickets where venue_id = ${venueId} and status in ('waiting', 'ready')
      ) + (
        select count(*) from booking_requests where venue_id = ${venueId} and service_date = ${serviceDate}
          and status in ('pending_publish', 'queued')
      ))::int as count
    `;
    const zones = await zoneUsage(tx, venueId, serviceDate);
    const [window] = await tx<{ maxAdvanceDays: number }[]>`select max_advance_days from queue_opening(${venueId})`;
    return {
      serviceDate, today: bangkokDate(), maxAdvanceDays: window.maxAdvanceDays, bookings: rows.map(bookingView), zones,
      metrics: {
        bookings: rows.length,
        guests: rows.reduce((sum, row) => sum + row.partySize, 0),
        pendingRequests: inFlight.count + rows.filter((row) => row.status === "pending_allocation").length,
        checkedIn: rows.filter((row) => row.status === "checked_in").length,
      },
    };
  });
}
