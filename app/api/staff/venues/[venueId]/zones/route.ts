import { zoneInput, zonesQuery } from "@/contracts/venue";
import { body, input, json } from "@/lib/http";
import { bangkokDate } from "@/lib/service-date";
import { changeZone, listZones } from "@/server/services/zones";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => {
  const { date } = input(zonesQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json(await listZones(staff.venueId, date ?? bangkokDate()));
});
export const POST = staffRoute(async (request, staff) =>
  json(await changeZone(staff, await body(request, zoneInput)), { status: 201 }));
