import { json, route } from "@/lib/http";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  const { venue } = await withDb((db) => db);
  const now = Date.now();
  const secondsUntilOpen = Math.max(0, Math.ceil((Date.parse(venue.opensAt) - now) / 1000));
  return json({
    slug: venue.slug, name: venue.name, opensAt: venue.opensAt, open: secondsUntilOpen === 0,
    secondsUntilOpen, today: today(), maxAdvanceDays: venue.maxAdvanceDays,
  });
});
