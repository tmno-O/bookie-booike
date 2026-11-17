import { json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { lineHealth } from "@/server/services/line-health";

/** Owner-only checklist of everything LINE notifications need. Reads only; sends no message. */
export const GET = staffRoute(async (_request, staff) => json(await lineHealth(staff.venueId)), true);
