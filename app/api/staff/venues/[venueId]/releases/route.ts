import { releaseInput } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { releases, saveRelease } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => json({ releases: await releases(staff.venueId) }));
export const PUT = staffRoute(async (request, staff) =>
  json(await saveRelease(staff, await body(request, releaseInput))), true);
