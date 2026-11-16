import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";
import { standardHours } from "@/contracts/hours";

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const standard = await body(request, standardHours);
  await withDb((db) => { db.venue.schedule.standard = standard; db.venue.maxAdvanceDays = standard.daysBefore; });
  return json({ standard });
});
