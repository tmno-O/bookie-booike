import { deliverNextNotification } from "../../../worker/notifications";
import { deliverNextAnnouncement } from "../../../worker/announcements";

export async function drainNotifications(maxMs = 20_000) {
  const deadline = Date.now() + Math.min(maxMs, 20_000);
  let bookings = 0, announcements = 0;
  // Leave enough budget for each bounded LINE request and its database commit.
  for (let i = 0; i < 40 && Date.now() + 5_500 < deadline; i++) {
    const booked = await deliverNextNotification();
    if (booked) bookings++;
    if (Date.now() + 5_500 >= deadline) break;
    const announced = await deliverNextAnnouncement();
    if (announced) announcements++;
    if (!booked && !announced) break;
  }
  return { bookings, announcements };
}
