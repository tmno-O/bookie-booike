import { ruleInput } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeRule, rules } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => json({ rules: await rules(staff.venueId) }));
export const PATCH = staffRoute(async (request, staff) =>
  json(await changeRule(staff, await body(request, ruleInput))), true);
