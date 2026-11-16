import { serviceHoursInput } from "@/contracts/hours";
import { body, json } from "@/lib/http";
import { saveServiceHours } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const PUT = staffRoute(async (request, staff) => {
  const hours = await body(request, serviceHoursInput);
  await saveServiceHours(staff, hours);
  return json({ openWeekdays: hours.openWeekdays, service: { start: hours.serviceStart, end: hours.serviceEnd } });
}, "FORBIDDEN");
