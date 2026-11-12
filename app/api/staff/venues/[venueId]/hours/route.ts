import { json } from "@/lib/http";
import { getBookingHours } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (_request, staff) => json(await getBookingHours(staff.venueId)), "FORBIDDEN");
