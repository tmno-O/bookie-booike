import { ApiError } from "../errors";
import type { Staff } from "./staff-auth";

export function requireOwner(staff: Staff) {
  if (staff.role !== "owner") throw new ApiError(403, "OWNER_REQUIRED", "Venue owner permission required");
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    throw new ApiError(403, "CROSS_ORIGIN_REQUEST", "Same-origin request required");
  }
}
