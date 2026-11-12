import { serviceDate } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { deleteSpecialHours } from "@/server/services/booking-hours";
import { staffRoute } from "@/server/staff-route";

export const DELETE = staffRoute<{ venueId: string; id: string }>(async (_request, staff, params) =>
  json(await deleteSpecialHours(staff, input(serviceDate, params.id))), "FORBIDDEN");
