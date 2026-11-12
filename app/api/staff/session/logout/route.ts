import { requireSameOrigin } from "@/lib/auth/permissions";
import { endStaffSession } from "@/lib/auth/staff-auth";
import { route } from "@/lib/http";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  return endStaffSession(request);
});
