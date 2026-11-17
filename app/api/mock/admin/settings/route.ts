import { z } from "zod";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner, requireStaff } from "@/mock/staff";
import { settingsPatch, venueSlugPatch } from "@/contracts/venue";
import { profileInput } from "@/mock/validation";

// Shop info shown to customers and the booking entry policy. Staff can read; only the owner can save.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const staff = requireStaff(request);
  return json(await withDb((db) => ({ profile: db.profile, ...db.cancellation, ...db.lineReminders,
    largePartyMode: db.largePartyMode, canEdit: staff.role === "owner" })));
});

export const PATCH = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  const patch = await body(request, z.union([venueSlugPatch, settingsPatch.pick({
    customerCancelEnabled: true, cancelCutoffMinutes: true, largePartyMode: true, bookingReminderHours: true, specialReminderHours: true,
    dayOfReminderHours: true, cancelDeadlineReminderHours: true, checkInMessages: true,
  })]));
  if ("slug" in patch) return json(await withDb((db) => ({ slug: db.venue.slug = patch.slug })));
  const { largePartyMode, bookingReminderHours, specialReminderHours, dayOfReminderHours, cancelDeadlineReminderHours,
    checkInMessages, ...cancellation } = patch;
  return json(await withDb((db) => {
    if (largePartyMode) db.largePartyMode = largePartyMode;
    const reminders = { bookingReminderHours, specialReminderHours, dayOfReminderHours, cancelDeadlineReminderHours, checkInMessages };
    for (const [key, value] of Object.entries(reminders)) {
      if (value !== undefined) Object.assign(db.lineReminders, { [key]: value });
    }
    return { ...Object.assign(db.cancellation, cancellation), ...db.lineReminders, largePartyMode: db.largePartyMode };
  }));
});

export const PUT = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const profile = await body(request, profileInput);
  await withDb((db) => { db.profile = profile; });
  return json({ profile });
});
