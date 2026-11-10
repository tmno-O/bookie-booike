import { randomUUID } from "node:crypto";
import { z } from "zod";
import { body, input, json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";
import { zoneInput } from "@/mock/validation";
import { assertNameFree, zoneRows } from "@/mock/zones";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const date = input(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), new URL(request.url).searchParams.get("date") ?? today());
  return json(await withDb((db) => ({ serviceDate: date, zones: zoneRows(db, date) })));
});

export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const data = await body(request, zoneInput);
  const zone = await withDb((db) => {
    assertNameFree(db, data.name);
    const created = { id: `zone-${randomUUID().slice(0, 8)}`, ...data };
    db.zones.push(created);
    return zoneRows(db, today()).find((r) => r.id === created.id)!;
  });
  return json({ zone }, { status: 201 });
});
