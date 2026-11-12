import { idempotencyKey, staffBookingInput } from "@/contracts/booking";
import { partySizeFor } from "@/contracts/party";
import { body, input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { createBookingRequest } from "@/server/services/booking-request";

export const POST = staffRoute(async (request, staff) => {
  const payload = await body(request, staffBookingInput);
  const key = input(idempotencyKey, request.headers.get("idempotency-key"));
  const actor = { type: "staff", id: staff.userId } as const;
  if ("customerId" in payload) {
    const { customerId, ...booking } = payload;
    return json(await createBookingRequest({ ...booking, venueId: staff.venueId }, customerId, actor, key), { status: 202 });
  }
  const { name, phone, party, serviceDate, zoneId } = payload;
  return json(await createBookingRequest({
    venueId: staff.venueId, serviceDate, zoneId, partyBucket: party, partySize: partySizeFor[party],
    contactName: name, contactPhone: phone,
  }, null, actor, key), { status: 202 });
});
