import { optOutInput } from "@/contracts/announcements";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const POST = route(async (request) => {
  assertMockEnabled();
  const { optOut } = await body(request, optOutInput);
  return json(await withDb((db) => {
    const customer = requireUser(db, request).id;
    db.announcementOptOut = db.announcementOptOut.filter((id) => id !== customer);
    if (optOut) db.announcementOptOut.push(customer);
    return { optedOut: optOut };
  }));
});
