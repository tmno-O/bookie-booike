import { id } from "@/contracts/common";
import { customerSession } from "@/lib/auth/customer-session";
import { input, json, route } from "@/lib/http";
import { getBookingRequest } from "@/server/services/booking-request";

export const GET = route<{ requestId: string }>(async (request, params) => {
  const customer = await customerSession(request);
  return json(await getBookingRequest(customer.venueId, input(id, params.requestId), customer.customerId));
});
