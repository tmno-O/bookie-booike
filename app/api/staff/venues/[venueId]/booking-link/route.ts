import { json } from "@/lib/http";
import { bookingLinks } from "@/server/booking-link";
import { staffRoute } from "@/server/staff-route";
import { getVenue } from "@/server/services/venue";

export const GET = staffRoute(async (request, staff) => {
  const venue = await getVenue(staff);
  return json(await bookingLinks(new URL(request.url).origin, venue.slug, venue.liffId));
});
