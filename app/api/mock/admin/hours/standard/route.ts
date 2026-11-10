import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";
import { standardHoursInput } from "@/mock/validation";

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const standard = await body(request, standardHoursInput);
  await withDb((db) => { db.venue.schedule.standard = standard; });
  return json({ standard });
});
