import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { mockAuditEntries } from "@/mock/audit";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route<{ id: string }>(async (request, params) => {
  assertMockEnabled(); requireStaff(request);
  return json(await withDb((db) => {
    if (!db.bookings.some((b) => b.id === params.id)) notFound("Booking");
    return { entries: mockAuditEntries(db, undefined, params.id), simulated: true };
  }));
});
