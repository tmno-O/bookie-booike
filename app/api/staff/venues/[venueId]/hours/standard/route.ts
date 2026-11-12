import { standardHours } from "@/contracts/hours";
import { body, json } from "@/lib/http";
import { saveStandardHours } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const PUT = staffRoute(async (request, staff) =>
  json(await saveStandardHours(staff, await body(request, standardHours))), "FORBIDDEN");
