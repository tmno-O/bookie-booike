import { customerBookingInput, idempotencyKey } from "@/contracts/booking";
import { partySizeFor } from "@/contracts/party";
import { customerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { body, input, json, route } from "@/lib/http";
import { createBookingRequest } from "@/server/services/booking-request";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  const payload = await body(request, customerBookingInput);
  const customer = await customerSession(request, payload.venueId);
  const booking = "ticketId" in payload ? { ...payload, partySize: partySizeFor[payload.partyBucket] } : payload;
  return json(await createBookingRequest(
    booking, customer.customerId, { type: "customer", id: customer.customerId, tokenHash: customer.tokenHash },
    input(idempotencyKey, request.headers.get("idempotency-key")),
  ), { status: 202 });
});
