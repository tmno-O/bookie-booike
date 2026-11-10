import { profilePatch } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeVenue, getVenue } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => json(await getVenue(staff)));
export const PATCH = staffRoute(async (request, staff) =>
  json(await changeVenue(staff, await body(request, profilePatch), "venue.profile_updated")), true);
