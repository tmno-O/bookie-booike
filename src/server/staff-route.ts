import { id } from "@/contracts/common";
import { requireOwner, requireSameOrigin } from "@/lib/auth/permissions";
import { staffSession, type Staff } from "@/lib/auth/staff-auth";
import { input, route } from "@/lib/http";

export function staffRoute<T extends { venueId: string }>(
  handler: (request: Request, staff: Staff, params: T) => Promise<Response>,
  ownerOnly = false,
) {
  return route<T>(async (request, params) => {
    if (!request.headers.has("authorization") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      requireSameOrigin(request);
    }
    const staff = await staffSession(request, input(id, params.venueId));
    if (ownerOnly) requireOwner(staff);
    return handler(request, staff, params);
  });
}
