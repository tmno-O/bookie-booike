import { id } from "@/contracts/common";
import { readStaffProfile, staffSession } from "@/lib/auth/staff-auth";
import { input, json, route } from "@/lib/http";

export const GET = route(async (request) => {
  const venueId = new URL(request.url).searchParams.get("venueId");
  return json(await readStaffProfile(await staffSession(request, venueId === null ? undefined : input(id, venueId))));
});
