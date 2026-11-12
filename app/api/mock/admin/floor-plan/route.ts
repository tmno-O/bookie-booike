import { floorPlan } from "@/contracts/floor-plan";
import { ApiError } from "@/lib/errors";
import { floorPlanState } from "@/lib/floor-plan";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner, requireStaff } from "@/mock/staff";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  return json(await withDb(({ floorPlan: stored }) => floorPlanState(stored.draft, stored.published, stored.publishedAt)));
});

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const plan = await body(request, floorPlan);
  return json(await withDb((db) => {
    const known = new Set(db.zones.map((zone) => zone.id));
    if (!plan.zones.every((zone) => known.has(zone.zoneId))) {
      throw new ApiError(400, "UNKNOWN_ZONE", "ผังอ้างถึงโซนที่ไม่มีอยู่ในร้าน");
    }
    db.floorPlan.draft = plan;
    return floorPlanState(db.floorPlan.draft, db.floorPlan.published, db.floorPlan.publishedAt);
  }));
});
