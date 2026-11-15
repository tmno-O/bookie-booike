import { json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { queueOpensAt } from "@/mock/schedule";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  const { venue, opensAt, profile } = await withDb((db) => ({ venue: db.venue, opensAt: queueOpensAt(db), profile: db.profile }));
  const now = Date.now();
  const secondsUntilOpen = Number.isFinite(opensAt) ? Math.max(0, Math.ceil((opensAt - now) / 1000)) : 0;
  return json({
    slug: venue.slug, name: venue.name, opensAt: Number.isFinite(opensAt) ? new Date(opensAt).toISOString() : null,
    open: Number.isFinite(opensAt) && secondsUntilOpen === 0,
    openWeekdays: venue.schedule.openWeekdays, closedDates: venue.schedule.closures,
    secondsUntilOpen, today: today(), maxAdvanceDays: venue.maxAdvanceDays,
    shop: { name: profile.name, phone: profile.phone, address: profile.address, entryPolicy: profile.entryPolicy },
  });
});
