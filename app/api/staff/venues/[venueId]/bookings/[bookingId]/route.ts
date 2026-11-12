import { cancellationInput } from "@/contracts/booking";
import { id } from "@/contracts/common";
import { body, input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { getStaffBooking } from "@/server/services/bookings";
import { cancelBooking } from "@/server/services/cancellation";

type Params = { venueId: string; bookingId: string };

export const GET = staffRoute<Params>(async (_request, staff, params) =>
  json(await getStaffBooking(staff.venueId, input(id, params.bookingId))));

export const PATCH = staffRoute<Params>(async (request, staff, params) => {
  await body(request, cancellationInput);
  return json(await cancelBooking(staff.venueId, input(id, params.bookingId), "staff", staff.userId));
});
