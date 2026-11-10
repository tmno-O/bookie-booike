import { randomUUID } from "node:crypto";
import { z } from "zod";
import { body, input, json, route } from "@/lib/http";
import { addBooking, checkSlot } from "@/mock/booking";
import { staffBookingView } from "@/mock/booking-view";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";
import { staffBookingInput } from "@/mock/validation";

const listQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["pending", "confirmed", "checked_in"]).optional(),
  zone: z.string().max(100).optional(),
  q: z.string().trim().max(80).optional(),
});

// Booking list for one night, with optional status, zone and name / phone / reference search.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const params = new URL(request.url).searchParams;
  const query = input(listQuery, {
    date: params.get("date") ?? today(), status: params.get("status") || undefined,
    zone: params.get("zone") || undefined, q: params.get("q") || undefined,
  });
  const needle = query.q?.toLowerCase().replace(/\s/g, "");
  return json(await withDb((db) => {
    const bookings = db.bookings.filter((b) => b.serviceDate === query.date
      && (!query.status || b.status === query.status) && (!query.zone || b.zoneId === query.zone)
      && (!needle || b.name.toLowerCase().includes(needle) || b.phone.includes(needle) || b.reference.toLowerCase().includes(needle)))
      .sort((a, b) => a.reference.localeCompare(b.reference))
      .map((b) => ({ ...staffBookingView(b), zoneId: b.zoneId }));
    return { serviceDate: query.date, total: bookings.length, bookings };
  }));
});

// Staff-assisted booking: creates a confirmed booking directly (no queue), channel "staff".
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const input = await body(request, staffBookingInput);
  const booking = await withDb((db) => {
    const zone = checkSlot(db, input.serviceDate, input.zoneId);
    return addBooking(db, {
      requestId: `staff-${randomUUID()}`, customerId: `staff-${randomUUID()}`, name: input.name, phone: input.phone,
      serviceDate: input.serviceDate, party: input.party, zone, channel: "staff",
    });
  });
  return json({ booking: {
    id: booking.id, reference: booking.reference, name: booking.name, phone: booking.phone,
    serviceDate: booking.serviceDate, party: booking.party, zoneName: booking.zoneName,
    channel: booking.channel, status: booking.status,
  } }, { status: 201 });
});
