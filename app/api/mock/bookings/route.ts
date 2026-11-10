import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { addDays, queueState, today, withDb, zoneAvailability, type Booking } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";
import { bookingInput } from "@/mock/validation";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const bookings = await withDb((db) => {
    const customer = requireUser(db, request).id;
    return db.bookings.filter((b) => b.customerId === customer)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.createdAt.localeCompare(b.createdAt));
  });
  return json({ bookings });
});

// Turn a ready queue request into a booking. Safe to retry with the same payload.
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const input = await body(request, bookingInput);
  const { booking, created } = await withDb((db) => {
    const customer = requireUser(db, request).id;
    const entry = db.queue.find((e) => e.id === input.requestId && e.customerId === customer);
    if (!entry) throw new ApiError(404, "NOT_FOUND", "Queue request not found");
    const zone = db.zones.find((z) => z.id === input.zoneId);
    if (entry.bookingId) {
      const prior = db.bookings.find((b) => b.id === entry.bookingId)!;
      if (prior.serviceDate === input.serviceDate && prior.party === input.party && prior.zoneId === input.zoneId) {
        return { booking: prior, created: false };
      }
      throw new ApiError(409, "REQUEST_USED", "This queue request already has a booking");
    }
    if (!queueState(db, entry).ready) throw new ApiError(409, "NOT_YOUR_TURN", "Your queue turn has not arrived yet");
    if (input.serviceDate < today() || input.serviceDate > addDays(today(), db.venue.maxAdvanceDays)) {
      throw new ApiError(422, "DATE_OUT_OF_RANGE", "Date is outside the bookable window");
    }
    if (!zone) throw new ApiError(422, "ZONE_NOT_FOUND", "Zone not found");
    if (!zoneAvailability(db, input.serviceDate).find((z) => z.id === zone.id)!.available) {
      throw new ApiError(409, "ZONE_FULL", "This zone is full for the selected night");
    }
    db.seq += 1;
    const made: Booking = {
      id: randomUUID(), reference: `BL-${input.serviceDate.slice(0, 4)}-${String(db.seq).padStart(4, "0")}`,
      requestId: entry.id, customerId: entry.customerId, name: entry.name, phone: entry.phone,
      serviceDate: input.serviceDate, party: input.party, zoneId: zone.id, zoneName: zone.name,
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(made);
    entry.bookingId = made.id;
    return { booking: made, created: true };
  });
  return json({ booking }, { status: created ? 201 : 200 });
});
