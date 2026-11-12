import { id } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { checkInBooking } from "@/server/services/check-in";
import { staffRoute } from "@/server/staff-route";

export const POST = staffRoute<{ venueId: string; bookingId: string }>(async (_request, staff, params) =>
  json(await checkInBooking(staff, input(id, params.bookingId))));
