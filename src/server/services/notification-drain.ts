import { after } from "next/server";
import { env } from "@/lib/env";
import { deliverNextNotification } from "../../../worker/notifications";
import { deliverNextAnnouncement } from "../../../worker/announcements";
import { fanoutPendingAnnouncements } from "./announcements";

/** Sends a booking's immediate notices right after the response; the Cron drain retries anything missed. */
export function scheduleBookingNotice(venueId: string, bookingId: string, kinds: readonly string[], label: string) {
  const config = env();
  if (!config.LINE_NOTIFICATIONS_ENABLED || config.LINE_VERIFY_MODE !== "real") return;
  try {
    after(async () => {
      try {
        const processed = await deliverNextNotification(undefined, venueId, bookingId, kinds);
        // An obsolete received notice may be ahead of the confirmation in the same booking's outbox.
        if (processed) await deliverNextNotification(undefined, venueId, bookingId, kinds);
      } catch (error) {
        console.error(`LINE ${label} will retry`, error instanceof Error ? error.name : "UnknownError");
      }
    });
  } catch {
    // Outside a Next.js request scope the existing Cron can pick up the persisted job.
  }
}

export function scheduleBookingConfirmation(venueId: string, bookingId: string) {
  scheduleBookingNotice(venueId, bookingId, ["received", "confirmed"], "confirmation");
}

export async function drainNotifications(maxMs = 20_000) {
  const deadline = Date.now() + Math.min(maxMs, 20_000);
  let bookings = 0, announcements = 0;
  // Resume any audience fan-out that did not finish when the special day was saved.
  if (Date.now() + 5_500 < deadline) {
    await fanoutPendingAnnouncements(5, Math.min(deadline - 5_500, Date.now() + 2_000));
  }
  // Leave enough budget for each bounded LINE request and its database commit.
  // One announcement step sends a multicast to up to 500 recipients.
  for (let i = 0; i < 200 && Date.now() + 5_500 < deadline; i++) {
    const booked = await deliverNextNotification();
    if (booked) bookings++;
    if (Date.now() + 5_500 >= deadline) break;
    const announced = await deliverNextAnnouncement();
    if (announced) announcements++;
    if (!booked && !announced) break;
  }
  return { bookings, announcements };
}
