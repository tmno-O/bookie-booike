import { auditQuery } from "@/contracts/audit";
import { input } from "@/lib/http";
import { exportAudit } from "@/server/services/audit-trail";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => new Response(
  await exportAudit(staff.venueId, input(auditQuery, Object.fromEntries(new URL(request.url).searchParams))),
  { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="booking-audit.csv"', "Cache-Control": "no-store" } },
), true);
