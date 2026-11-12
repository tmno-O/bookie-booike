import { id } from "@/contracts/common";
import { zonePatch } from "@/contracts/venue";
import { body, input, json } from "@/lib/http";
import { changeZone, getZone } from "@/server/services/zones";
import { staffRoute } from "@/server/staff-route";

type Params = { venueId: string; zoneId: string };

export const GET = staffRoute<Params>(async (_request, staff, params) =>
  json(await getZone(staff.venueId, input(id, params.zoneId))));
export const PATCH = staffRoute<Params>(async (request, staff, params) =>
  json(await changeZone(staff, await body(request, zonePatch), input(id, params.zoneId))));
export const DELETE = staffRoute<Params>(async (_request, staff, params) =>
  json(await changeZone(staff, { status: "closed" }, input(id, params.zoneId))));
