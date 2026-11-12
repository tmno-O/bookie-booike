import { floorPlan } from "@/contracts/floor-plan";
import { body, json } from "@/lib/http";
import { saveFloorPlanDraft, staffFloorPlan } from "@/server/services/floor-plan";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (_request, staff) => json(await staffFloorPlan(staff.venueId)));
export const PUT = staffRoute(async (request, staff) =>
  json(await saveFloorPlanDraft(staff, await body(request, floorPlan))), true);
