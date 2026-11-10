import { ApiError } from "../errors";
import type { Staff } from "./staff-auth";

export function requireOwner(staff: Staff) {
  if (staff.role !== "owner") throw new ApiError(403, "OWNER_REQUIRED", "Venue owner permission required");
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const expected = `${url.protocol}//${host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) {
    throw new ApiError(403, "CROSS_ORIGIN_REQUEST", "Same-origin request required");
  }
}
