import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { MOCK_STAFF, requireStaff } from "@/mock/staff";

// Team members (the mock staff accounts) and pending invitations.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const me = requireStaff(request);
  const invites = await withDb((db) => db.invites);
  return json({ members: MOCK_STAFF, invites, canEdit: me.role === "owner" });
});
