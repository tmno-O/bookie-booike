import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";

// Customers only see the published copy of the plan.
export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  return json(await withDb(({ floorPlan: stored }) => ({ plan: stored.published })));
});
