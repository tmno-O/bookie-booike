import { ApiError, notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { staffBookingView } from "@/mock/booking-view";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

// Mark a booking as checked in. Only on its service night, and only once.
export const POST = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireStaff(request);
  const booking = await withDb((db) => {
    const found = db.bookings.find((b) => b.id === params.id);
    if (!found) notFound("Booking");
    if (found.status === "checked_in") throw new ApiError(409, "ALREADY_CHECKED_IN", "This booking is already checked in");
    if (found.serviceDate !== today()) throw new ApiError(409, "NOT_SERVICE_DATE", "Check-in is only available on the booked night");
    found.status = "checked_in";
    found.checkedInAt = new Date().toISOString();
    return found;
  });
  return json({ booking: staffBookingView(booking) });
});
