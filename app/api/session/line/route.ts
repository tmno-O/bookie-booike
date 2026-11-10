import { lineSessionInput } from "@/contracts/booking";
import { startCustomerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { body, route } from "@/lib/http";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  const { venueSlug, idToken } = await body(request, lineSessionInput);
  return startCustomerSession(request, venueSlug, idToken);
});
