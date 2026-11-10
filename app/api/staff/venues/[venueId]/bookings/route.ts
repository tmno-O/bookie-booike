import { json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { listBookings } from "@/server/services/bookings";

export const GET = staffRoute(async (request, staff) => json(await listBookings(staff, request)));
