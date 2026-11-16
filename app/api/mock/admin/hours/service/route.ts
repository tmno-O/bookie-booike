import { serviceHoursInput } from "@/contracts/hours";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const PUT = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const hours = await body(request, serviceHoursInput);
  await withDb((db) => {
    db.venue.schedule.openWeekdays = hours.openWeekdays;
    db.venue.schedule.service = { start: hours.serviceStart, end: hours.serviceEnd };
  });
  return json({ openWeekdays: hours.openWeekdays, service: { start: hours.serviceStart, end: hours.serviceEnd } });
});
