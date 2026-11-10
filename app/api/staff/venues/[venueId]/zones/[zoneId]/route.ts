import { id } from "@/contracts/common";
import { zonePatch } from "@/contracts/venue";
import { body, input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeInventory, inventory } from "@/server/services/inventory";

type Params = { venueId: string; zoneId: string };

export const GET = staffRoute<Params>(async (_request, staff, params) =>
  json(await inventory(staff.venueId, "zones", input(id, params.zoneId))));
export const PATCH = staffRoute<Params>(async (request, staff, params) =>
  json(await changeInventory(staff, "zones", await body(request, zonePatch), input(id, params.zoneId))));
export const DELETE = staffRoute<Params>(async (_request, staff, params) =>
  json(await changeInventory(staff, "zones", { status: "closed" }, input(id, params.zoneId))));
