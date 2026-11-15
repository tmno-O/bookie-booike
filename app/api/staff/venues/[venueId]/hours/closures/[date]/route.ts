import { serviceDate } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { removeClosure } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const DELETE = staffRoute<{ venueId: string; date: string }>(async (_request, staff, params) =>
  json(await removeClosure(staff, input(serviceDate, params.date))), "FORBIDDEN");
