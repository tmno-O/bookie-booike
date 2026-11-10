import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";
import { specialDayInput } from "@/mock/validation";

export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const data = await body(request, specialDayInput);
  const special = await withDb((db) => {
    if (data.serviceDate < today()) throw new ApiError(422, "DATE_IN_PAST", "The night has already passed");
    if (db.venue.schedule.specials.some((s) => s.serviceDate === data.serviceDate)) {
      throw new ApiError(409, "SPECIAL_DAY_EXISTS", "This night already has special opening hours");
    }
    const created = { id: randomUUID(), ...data };
    db.venue.schedule.specials.push(created);
    return created;
  });
  return json({ special }, { status: 201 });
});
