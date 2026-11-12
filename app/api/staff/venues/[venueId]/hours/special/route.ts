import { specialHours } from "@/contracts/hours";
import { body, json } from "@/lib/http";
import { addSpecialHours } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const POST = staffRoute(async (request, staff) =>
  json(await addSpecialHours(staff, await body(request, specialHours)), { status: 201 }), "FORBIDDEN");
