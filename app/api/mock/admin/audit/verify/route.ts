import { json, route } from "@/lib/http";
import { mockAuditEntries } from "@/mock/audit";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route(async (request) => {
  assertMockEnabled(); requireStaff(request);
  return json(await withDb((db) => ({ valid: true, checked: mockAuditEntries(db).length,
    firstBadSeq: null, firstBadId: null, lastSeq: null, headHash: null, simulated: true })));
});
