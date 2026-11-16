import { auditQuery } from "@/contracts/audit";
import { input, json } from "@/lib/http";
import { nightTimeline } from "@/server/services/audit-trail";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) =>
  json(await nightTimeline(staff.venueId, input(auditQuery, Object.fromEntries(new URL(request.url).searchParams)))));
