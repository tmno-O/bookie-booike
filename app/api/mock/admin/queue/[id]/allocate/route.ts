import { z } from "zod";
import { ApiError, notFound } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { ensureCapacity } from "@/mock/booking";
import { queueRowView } from "@/mock/booking-view";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

// Allocate a pending request: confirm it in the requested zone, or in another zone if `zoneId` is given.
export const POST = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireStaff(request);
  const text = await request.clone().text();
  const { zoneId } = text.trim() ? await body(request, z.strictObject({ zoneId: z.string().min(1).max(100).optional() })) : { zoneId: undefined };
  const booking = await withDb((db) => {
    const found = db.bookings.find((b) => b.id === params.id && b.channel === "line");
    if (!found) notFound("Request");
    if (found.status !== "pending") throw new ApiError(409, "ALREADY_ALLOCATED", "This request is already allocated");
    const zone = ensureCapacity(db, found.serviceDate, zoneId ?? found.zoneId);
    found.zoneId = zone.id;
    found.zoneName = zone.name;
    found.status = "confirmed";
    return found;
  });
  return json({ request: queueRowView(booking) });
});
