import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { staffBookingView } from "@/mock/booking-view";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireStaff(request);
  const booking = await withDb((db) => db.bookings.find((b) => b.id === params.id));
  if (!booking) notFound("Booking");
  return json({ booking: staffBookingView(booking) });
});
