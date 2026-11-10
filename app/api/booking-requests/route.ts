import { customerBookingInput, idempotencyKey } from "@/contracts/booking";
import { customerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { body, input, json, route } from "@/lib/http";
import { createBookingRequest } from "@/server/services/booking-request";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  const booking = await body(request, customerBookingInput);
  const customer = await customerSession(request, booking.venueId);
  return json(await createBookingRequest(
    booking, customer.customerId, { type: "customer", id: customer.customerId, tokenHash: customer.tokenHash },
    input(idempotencyKey, request.headers.get("idempotency-key")),
  ), { status: 202 });
});
