import { id } from "@/contracts/common";
import { tablePatch } from "@/contracts/venue";
import { body, input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeInventory, inventory } from "@/server/services/inventory";

type Params = { venueId: string; tableId: string };

export const GET = staffRoute<Params>(async (_request, staff, params) =>
  json(await inventory(staff.venueId, "venue_tables", input(id, params.tableId))));
export const PATCH = staffRoute<Params>(async (request, staff, params) =>
  json(await changeInventory(staff, "venue_tables", await body(request, tablePatch), input(id, params.tableId))));
export const DELETE = staffRoute<Params>(async (_request, staff, params) =>
  json(await changeInventory(staff, "venue_tables", { status: "closed" }, input(id, params.tableId))));
