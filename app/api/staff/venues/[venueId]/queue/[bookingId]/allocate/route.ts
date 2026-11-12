import { id } from "@/contracts/common";
import { allocationInput } from "@/contracts/queue";
import { body, input, json } from "@/lib/http";
import { allocateBooking } from "@/server/services/staff-queue";
import { staffRoute } from "@/server/staff-route";

export const POST = staffRoute<{ venueId: string; bookingId: string }>(async (request, staff, params) => {
  const hasBody = request.body && (await request.clone().text()).trim();
  const { zoneId } = hasBody ? await body(request, allocationInput) : {};
  return json(await allocateBooking(staff, input(id, params.bookingId), zoneId));
});
