import { auditQuery } from "@/contracts/audit";
import { csvRows } from "@/lib/csv";
import { input, route } from "@/lib/http";
import { mockAuditEntries } from "@/mock/audit";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

export const GET = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const { date = today(), q } = input(auditQuery, Object.fromEntries(new URL(request.url).searchParams));
  const rows = await withDb((db) => mockAuditEntries(db, date).filter((r) => !q || r.reference?.toLowerCase().includes(q.toLowerCase()) || (/^\d{4}$/.test(q) && r.phone.endsWith(q))));
  return new Response(csvRows([["SIMULATED", "seq", "createdAt", "action", "reference", "phone", "rowHash"],
    ...rows.map((r) => ["true", r.seq, r.createdAt, r.action, r.reference, r.phone, r.rowHash])]),
  { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="mock-audit.csv"' } });
});
