import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { customerBookingView } from "@/mock/booking-view";
import { addBooking, checkSlot } from "@/mock/booking";
import { queueState, withDb } from "@/mock/db";
import { isNightOpen } from "@/mock/schedule";
import { assertMockEnabled, requireUser } from "@/mock/session";
import { bookingInput } from "@/mock/validation";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const bookings = await withDb((db) => {
    const customer = requireUser(db, request).id;
    return db.bookings.filter((b) => b.customerId === customer)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.createdAt.localeCompare(b.createdAt)).map((b) => customerBookingView(db, b));
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
    if (entry.bookingId) {
      const prior = db.bookings.find((b) => b.id === entry.bookingId)!;
      if (prior.serviceDate === input.serviceDate && prior.party === input.party && prior.zoneId === input.zoneId) {
        return { booking: prior, created: false };
      }
      throw new ApiError(409, "REQUEST_USED", "This queue request already has a booking");
    }
    if (!queueState(db, entry).ready) throw new ApiError(409, "NOT_YOUR_TURN", "Your queue turn has not arrived yet");
    const zone = checkSlot(db, input.serviceDate, input.zoneId);
    if (!isNightOpen(db, input.serviceDate)) throw new ApiError(409, "NIGHT_NOT_OPEN", "Booking has not opened for this night yet");
    const made = addBooking(db, {
      requestId: entry.id, customerId: entry.customerId, name: entry.name, phone: entry.phone,
      serviceDate: input.serviceDate, party: input.party, zone, channel: "line", requestedAt: entry.createdAt,
    });
    entry.bookingId = made.id;
    return { booking: made, created: true };
  });
  return json({ booking }, { status: created ? 201 : 200 });
});
