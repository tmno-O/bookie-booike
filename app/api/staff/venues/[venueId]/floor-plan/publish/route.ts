import { json } from "@/lib/http";
import { publishFloorPlan } from "@/server/services/floor-plan";
import { staffRoute } from "@/server/staff-route";

export const POST = staffRoute(async (_request, staff) => json(await publishFloorPlan(staff)), true);
