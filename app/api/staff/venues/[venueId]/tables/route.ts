import { tableInput } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeInventory, inventory } from "@/server/services/inventory";

export const GET = staffRoute(async (_request, staff) => json({ tables: await inventory(staff.venueId, "venue_tables") }));
export const POST = staffRoute(async (request, staff) =>
  json(await changeInventory(staff, "venue_tables", await body(request, tableInput)), { status: 201 }));
