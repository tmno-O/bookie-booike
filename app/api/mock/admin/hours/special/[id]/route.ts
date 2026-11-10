import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const DELETE = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireOwner(request);
  await withDb((db) => {
    const index = db.venue.schedule.specials.findIndex((s) => s.id === params.id);
    if (index < 0) notFound("Special day");
    db.venue.schedule.specials.splice(index, 1);
  });
  return json({ ok: true });
});
