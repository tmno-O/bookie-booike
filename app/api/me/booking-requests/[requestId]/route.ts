import { id } from "@/contracts/common";
import { customerSession } from "@/lib/auth/customer-session";
import { input, json, route } from "@/lib/http";
import { getBookingRequest } from "@/server/services/booking-request";
import { scheduleBookingConfirmation } from "@/server/services/notification-drain";

export const GET = route<{ requestId: string }>(async (request, params) => {
  const customer = await customerSession(request);
  const result = await getBookingRequest(customer.venueId, input(id, params.requestId), customer.customerId);
  if (result.status === "confirmed" && result.bookingId) scheduleBookingConfirmation(customer.venueId, result.bookingId);
  return json(result);
});
