import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner, requireStaff } from "@/mock/staff";
import { profileInput } from "@/mock/validation";

// Shop info shown to customers and the booking entry policy. Staff can read; only the owner can save.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const staff = requireStaff(request);
  return json({ profile: await withDb((db) => db.profile), canEdit: staff.role === "owner" });
});

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const profile = await body(request, profileInput);
  await withDb((db) => { db.profile = profile; });
  return json({ profile });
});
