import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { queueRowView } from "@/mock/booking-view";
import { withDb, zoneAvailability } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireStaff(request);
  return json(await withDb((db) => {
    const found = db.bookings.find((b) => b.id === params.id && b.channel === "line");
    if (!found) notFound("Request");
    return { request: queueRowView(found), phone: found.phone, zones: zoneAvailability(db, found.serviceDate) };
  }));
});
