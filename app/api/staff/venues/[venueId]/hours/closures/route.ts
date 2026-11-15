import { closureInput, weekdaysInput } from "@/contracts/hours";
import { serviceDate } from "@/contracts/common";
import { body, input, json } from "@/lib/http";
import { addClosure, closureImpact, listClosures, saveOpenWeekdays } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => {
  const date = new URL(request.url).searchParams.get("date");
  return json(date ? await closureImpact(staff.venueId, input(serviceDate, date)) : { closures: await listClosures(staff.venueId) });
}, "FORBIDDEN");
export const POST = staffRoute(async (request, staff) =>
  json(await addClosure(staff, await body(request, closureInput)), { status: 201 }), "FORBIDDEN");
export const PUT = staffRoute(async (request, staff) => {
  const { openWeekdays } = await body(request, weekdaysInput);
  await saveOpenWeekdays(staff, openWeekdays);
  return json({ openWeekdays });
}, "FORBIDDEN");
