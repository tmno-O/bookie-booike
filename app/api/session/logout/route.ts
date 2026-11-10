import { endCustomerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { route } from "@/lib/http";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  return endCustomerSession(request);
});
