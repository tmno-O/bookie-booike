import { json, route } from "@/lib/http";
import { cancelMockBooking } from "@/mock/booking-view";
import { withDb } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const POST = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  return json(await withDb((db) => ({ booking: cancelMockBooking(db, params.id, requireUser(db, request).id) })));
});
