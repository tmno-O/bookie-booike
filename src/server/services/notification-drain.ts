import { deliverNextNotification } from "../../../worker/notifications";
import { deliverNextAnnouncement } from "../../../worker/announcements";
import { fanoutPendingAnnouncements } from "./announcements";

export async function drainNotifications(maxMs = 20_000) {
  const deadline = Date.now() + Math.min(maxMs, 20_000);
  let bookings = 0, announcements = 0;
  // Resume any audience fan-out that did not finish when the special day was saved.
  await fanoutPendingAnnouncements();
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
