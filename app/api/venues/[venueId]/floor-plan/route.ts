import { id } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { publicFloorPlan } from "@/server/services/floor-plan";

export const GET = route<{ venueId: string }>(async (_request, params) =>
  json(await publicFloorPlan(input(id, params.venueId))));
