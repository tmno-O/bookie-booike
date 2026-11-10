import { lineIntegrationPatch } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { lineIntegration, saveLineIntegration } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => json({ integration: await lineIntegration(staff.venueId) }), true);
export const PATCH = staffRoute(async (request, staff) =>
  json({ integration: await saveLineIntegration(staff, await body(request, lineIntegrationPatch)) }), true);
