import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { MOCK_STAFF, requireOwner } from "@/mock/staff";
import { inviteInput } from "@/mock/validation";

// Invite a staff member by email. Invitations are recorded as pending (no real email is sent in the mock).
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const data = await body(request, inviteInput);
  const invite = await withDb((db) => {
    if (MOCK_STAFF.some((m) => m.email === data.email)) throw new ApiError(409, "ALREADY_MEMBER", "This person is already on the team");
    if (db.invites.some((i) => i.email === data.email)) throw new ApiError(409, "INVITE_EXISTS", "This email has already been invited");
    const created = { id: randomUUID(), ...data, createdAt: new Date().toISOString() };
    db.invites.push(created);
    return created;
  });
  return json({ invite }, { status: 201 });
});
