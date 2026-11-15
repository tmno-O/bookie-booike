import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner, requireStaff } from "@/mock/staff";
import { profileInput } from "@/mock/validation";
import { settingsPatch } from "@/contracts/venue";

// Shop info shown to customers and the booking entry policy. Staff can read; only the owner can save.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const staff = requireStaff(request);
  return json(await withDb((db) => ({ profile: db.profile, ...db.cancellation, largePartyMode: db.largePartyMode, canEdit: staff.role === "owner" })));
});

export const PATCH = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const { largePartyMode, ...patch } = await body(request, settingsPatch.pick({ customerCancelEnabled: true, cancelCutoffMinutes: true, largePartyMode: true }));
  return json(await withDb((db) => {
    if (largePartyMode) db.largePartyMode = largePartyMode;
    return { ...Object.assign(db.cancellation, patch), largePartyMode: db.largePartyMode };
  }));
});

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const profile = await body(request, profileInput);
  await withDb((db) => { db.profile = profile; });
  return json({ profile });
});
