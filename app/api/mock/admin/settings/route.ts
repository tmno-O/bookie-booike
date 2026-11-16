import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner, requireStaff } from "@/mock/staff";
import { settingsPatch } from "@/contracts/venue";
import { profileInput } from "@/mock/validation";

// Shop info shown to customers and the booking entry policy. Staff can read; only the owner can save.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const staff = requireStaff(request);
  return json(await withDb((db) => ({ profile: db.profile, cancelCutoffMinutes: db.venue.cancelCutoffMinutes, canEdit: staff.role === "owner" })));
});

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const profile = await body(request, profileInput);
  await withDb((db) => { db.profile = profile; });
  return json({ profile });
});

export const PATCH = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const { cancelCutoffMinutes } = await body(request, settingsPatch);
  return json(await withDb((db) => {
    if (cancelCutoffMinutes !== undefined) db.venue.cancelCutoffMinutes = cancelCutoffMinutes;
    return { cancelCutoffMinutes: db.venue.cancelCutoffMinutes };
  }));
});
