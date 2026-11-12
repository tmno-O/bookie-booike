import { ApiError } from "@/lib/errors";
import { floorPlanState } from "@/lib/floor-plan";
import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  return json(await withDb(({ floorPlan: stored }) => {
    if (!stored.draft) throw new ApiError(409, "NO_FLOOR_PLAN", "บันทึกผังก่อนเผยแพร่");
    stored.published = structuredClone(stored.draft);
    stored.publishedAt = new Date().toISOString();
    return floorPlanState(stored.draft, stored.published, stored.publishedAt);
  }));
});
