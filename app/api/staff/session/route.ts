import { staffLoginInput } from "@/contracts/staff";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { startStaffSession } from "@/lib/auth/staff-auth";
import { body, route } from "@/lib/http";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  return startStaffSession(request, await body(request, staffLoginInput));
});
