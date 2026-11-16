import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";
import { bookingLinks } from "@/server/booking-link";

export const GET = route(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const slug = await withDb((db) => db.venue.slug);
  return json(await bookingLinks(new URL(request.url).origin, slug, null));
});
