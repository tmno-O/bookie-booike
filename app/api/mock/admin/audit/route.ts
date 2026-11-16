import { auditQuery } from "@/contracts/audit";
import { input, json, route } from "@/lib/http";
import { mockAuditEntries } from "@/mock/audit";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route(async (request) => {
  assertMockEnabled(); requireStaff(request);
  const query = input(auditQuery, Object.fromEntries(new URL(request.url).searchParams));
  const date = query.date ?? today();
  return json(await withDb((db) => {
    const rows = mockAuditEntries(db, date).filter((r) => !query.q || r.reference?.toLowerCase().includes(query.q.toLowerCase())
      || (/^\d{4}$/.test(query.q) && r.phone.endsWith(query.q)));
    return { date, entries: rows.slice(query.offset, query.offset + query.limit),
      nextOffset: rows.length > query.offset + query.limit ? query.offset + query.limit : null, simulated: true };
  }));
});
