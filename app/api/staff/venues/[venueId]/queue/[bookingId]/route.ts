import { id } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { getStaffQueueItem } from "@/server/services/staff-queue";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute<{ venueId: string; bookingId: string }>(async (_request, staff, params) =>
  json(await getStaffQueueItem(staff.venueId, input(id, params.bookingId))));
