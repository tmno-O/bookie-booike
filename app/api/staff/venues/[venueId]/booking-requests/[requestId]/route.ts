import { id } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { getBookingRequest } from "@/server/services/booking-request";

export const GET = staffRoute<{ venueId: string; requestId: string }>(async (_request, staff, params) =>
  json(await getBookingRequest(staff.venueId, input(id, params.requestId))));
