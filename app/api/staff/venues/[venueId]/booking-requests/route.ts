import { idempotencyKey, staffBookingInput } from "@/contracts/booking";
import { body, input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { createBookingRequest } from "@/server/services/booking-request";

export const POST = staffRoute(async (request, staff) => {
  const { customerId, ...booking } = await body(request, staffBookingInput);
  return json(await createBookingRequest(
    { ...booking, venueId: staff.venueId }, customerId, { type: "staff", id: staff.userId },
    input(idempotencyKey, request.headers.get("idempotency-key")),
  ), { status: 202 });
});
