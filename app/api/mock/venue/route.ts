import { json, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { today, withDb } from "@/mock/db";
import { bookingSchedule } from "@/mock/schedule";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const { venue, schedule, profile, largePartyMode } = await withDb((db) => ({ venue: db.venue, schedule: bookingSchedule(db), profile: db.profile, largePartyMode: db.largePartyMode }));
  const slug = new URL(request.url).searchParams.get("slug");
  if (slug !== null && slug !== venue.slug) notFound("Venue");
  return json({
    slug: venue.slug, name: venue.name, timezone: venue.timezone, ...schedule,
    openWeekdays: venue.schedule.openWeekdays, closedDates: venue.schedule.closures,
    largePartyMode, today: today(), maxAdvanceDays: venue.maxAdvanceDays,
    shop: { name: profile.name, phone: profile.phone, address: profile.address, entryPolicy: profile.entryPolicy },
  });
});
