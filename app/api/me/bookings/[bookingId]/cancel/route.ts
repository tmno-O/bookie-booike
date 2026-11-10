import { id } from "@/contracts/common";
import { customerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { input, json, route } from "@/lib/http";
import { cancelBooking } from "@/server/services/cancellation";

export const POST = route<{ bookingId: string }>(async (request, params) => {
  requireSameOrigin(request);
  const customer = await customerSession(request);
  return json(await cancelBooking(customer.venueId, input(id, params.bookingId), "customer", customer.customerId));
});
