import { notFound } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";
import { zonePatch } from "@/mock/validation";
import { assertCapacityCovers, assertNameFree, zoneRows } from "@/mock/zones";

// Edit a zone's name, capacity (seats) or open/closed status. Closing keeps existing bookings.
export const PATCH = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  requireStaff(request);
  const patch = await body(request, zonePatch);
  const zone = await withDb((db) => {
    const found = db.zones.find((z) => z.id === params.id);
    if (!found) notFound("Zone");
    if (patch.name !== undefined) assertNameFree(db, patch.name, found.id);
    if (patch.seats !== undefined) assertCapacityCovers(db, found, patch.seats);
    Object.assign(found, patch);
    if (patch.name !== undefined) for (const b of db.bookings) if (b.zoneId === found.id) b.zoneName = found.name;
    return zoneRows(db, today()).find((r) => r.id === found.id)!;
  });
  return json({ zone });
});
