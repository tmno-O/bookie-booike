import { staffQueueQuery } from "@/contracts/queue";
import { input, json } from "@/lib/http";
import { listStaffQueue } from "@/server/services/staff-queue";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => {
  const query = input(staffQueueQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json(await listStaffQueue(staff.venueId, query));
});
