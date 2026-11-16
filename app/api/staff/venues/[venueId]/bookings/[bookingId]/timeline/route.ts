import { id } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { bookingTimeline } from "@/server/services/audit-trail";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute<{ venueId: string; bookingId: string }>(async (_request, staff, params) =>
  json(await bookingTimeline(staff.venueId, input(id, params.bookingId))));
