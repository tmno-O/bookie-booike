import { verifyQuery } from "@/contracts/audit";
import { input, json } from "@/lib/http";
import { verifyChain } from "@/server/services/audit-trail";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) =>
  json(await verifyChain(staff.venueId, input(verifyQuery, Object.fromEntries(new URL(request.url).searchParams)))));
