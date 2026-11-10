import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const GET = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  const booking = await withDb((db) => {
    const customer = requireUser(db, request).id;
    return db.bookings.find((b) => b.id === params.id && b.customerId === customer);
  });
  if (!booking) notFound("Booking");
  return json({ booking });
});
