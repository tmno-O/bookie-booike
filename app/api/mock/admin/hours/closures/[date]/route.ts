import { serviceDate } from "@/contracts/common";
import { notFound } from "@/lib/errors";
import { input, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const DELETE = route<{ date: string }>(async (request, params) => {
  assertMockEnabled(); requireOwner(request);
  const date = input(serviceDate, params.date);
  await withDb((db) => {
    if (!db.venue.schedule.closures.some((c) => c.serviceDate === date)) notFound("Closure");
    db.venue.schedule.closures = db.venue.schedule.closures.filter((c) => c.serviceDate !== date);
  });
  return json({ ok: true });
});
