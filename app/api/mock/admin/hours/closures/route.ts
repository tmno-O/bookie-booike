import { closureInput, weekdaysInput } from "@/contracts/hours";
import { serviceDate } from "@/contracts/common";
import { ApiError } from "@/lib/errors";
import { body, input, json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const GET = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const date = new URL(request.url).searchParams.get("date");
  if (date) return json(await withDb((db) => ({ affectedBookings: db.bookings.filter((b) => b.status !== "cancelled" && b.serviceDate === input(serviceDate, date)).length })));
  return json(await withDb((db) => ({ closures: db.venue.schedule.closures.map((c) => ({ ...c,
    affectedBookings: db.bookings.filter((b) => b.status !== "cancelled" && b.serviceDate === c.serviceDate).length,
  })) })));
});
export const POST = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const closure = await body(request, closureInput);
  return json(await withDb((db) => {
    if (closure.serviceDate < today()) throw new ApiError(422, "DATE_IN_PAST", "คืนที่เลือกผ่านมาแล้ว");
    if (db.venue.schedule.closures.some((c) => c.serviceDate === closure.serviceDate)) throw new ApiError(409, "CLOSURE_EXISTS", "คืนนี้ปิดพิเศษอยู่แล้ว");
    db.venue.schedule.closures.push(closure);
    return { closure: { ...closure, affectedBookings: db.bookings.filter((b) => b.status !== "cancelled" && b.serviceDate === closure.serviceDate).length } };
  }), { status: 201 });
});
export const PUT = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const { openWeekdays } = await body(request, weekdaysInput);
  await withDb((db) => { db.venue.schedule.openWeekdays = openWeekdays; });
  return json({ openWeekdays });
});
