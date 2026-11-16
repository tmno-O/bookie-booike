import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { isServiceNightOpen, opensAtFor } from "@/mock/schedule";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const GET = route(async (request) => {
  assertMockEnabled();
  return json(await withDb((db) => {
    const customer = requireUser(db, request).id;
    const optedOut = db.announcementOptOut.includes(customer);
    return { optedOut, announcements: optedOut ? [] : db.announcements.filter((a) => a.recipients.includes(customer)
      && isServiceNightOpen(db, a.serviceDate) && db.venue.schedule.specials.some((s) => s.serviceDate === a.serviceDate)
      && Date.parse(a.opensAt) === opensAtFor(db, a.serviceDate) && Date.now() < Date.parse(`${a.serviceDate}T02:00:00+07:00`) + 86_400_000)
      .map(({ id, title, serviceDate, opensAt }) => ({ id, title, serviceDate, opensAt, timezone: db.venue.timezone })) };
  }));
});
