import { notFound } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const DELETE = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireOwner(request);
  await withDb((db) => {
    const index = db.invites.findIndex((i) => i.id === params.id);
    if (index < 0) notFound("Invitation");
    db.invites.splice(index, 1);
  });
  return json({ ok: true });
});
