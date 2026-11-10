import { json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { queueOpensAt } from "@/mock/schedule";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  const { venue, opensAt, profile } = await withDb((db) => ({ venue: db.venue, opensAt: queueOpensAt(db), profile: db.profile }));
  const now = Date.now();
  const secondsUntilOpen = Math.max(0, Math.ceil((opensAt - now) / 1000));
  return json({
    slug: venue.slug, name: venue.name, opensAt: new Date(opensAt).toISOString(), open: secondsUntilOpen === 0,
    secondsUntilOpen, today: today(), maxAdvanceDays: venue.maxAdvanceDays,
    shop: { name: profile.name, phone: profile.phone, address: profile.address, entryPolicy: profile.entryPolicy },
  });
});
