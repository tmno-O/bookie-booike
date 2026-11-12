import { tableInput } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeTable, tables } from "@/server/services/inventory";

export const GET = staffRoute(async (_request, staff) => json({ tables: await tables(staff.venueId) }));
export const POST = staffRoute(async (request, staff) =>
  json(await changeTable(staff, await body(request, tableInput)), { status: 201 }));
