import { notFound } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { cancellationInput } from "@/contracts/booking";
import { cancelMockBooking, staffBookingView } from "@/mock/booking-view";
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

export const PATCH = route<{ id: string }>(async (request, params) => {
  assertMockEnabled(); requireStaff(request);
  await body(request, cancellationInput);
  return json(await withDb((db) => {
    cancelMockBooking(db, params.id);
    return { booking: staffBookingView(db.bookings.find((b) => b.id === params.id)!) };
  }));
});
