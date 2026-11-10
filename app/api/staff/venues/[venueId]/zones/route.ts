import { zoneInput } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeInventory, inventory } from "@/server/services/inventory";

export const GET = staffRoute(async (_request, staff) => json({ zones: await inventory(staff.venueId, "zones") }));
export const POST = staffRoute(async (request, staff) =>
  json(await changeInventory(staff, "zones", await body(request, zoneInput)), { status: 201 }));
