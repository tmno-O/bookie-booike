import { customerSession } from "@/lib/auth/customer-session";
import { json, route } from "@/lib/http";
import { listBookings } from "@/server/services/bookings";

export const GET = route(async (request) => json(await listBookings(await customerSession(request), request)));
