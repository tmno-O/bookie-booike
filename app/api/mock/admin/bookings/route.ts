import { randomUUID } from "node:crypto";
import { body, json, route } from "@/lib/http";
import { addBooking, checkSlot } from "@/mock/booking";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";
import { staffBookingInput } from "@/mock/validation";

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
