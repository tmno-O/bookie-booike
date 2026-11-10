import { id } from "@/contracts/common";
import { customerSession } from "@/lib/auth/customer-session";
import { input, json, route } from "@/lib/http";
import { getBooking } from "@/server/services/bookings";

export const GET = route<{ bookingId: string }>(async (request, params) =>
  json(await getBooking(await customerSession(request), input(id, params.bookingId))));
