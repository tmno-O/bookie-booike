import { env } from "@/lib/env";
import { json, route } from "@/lib/http";
import { requireCron } from "@/server/cron-auth";
import { drainNotifications } from "@/server/services/notification-drain";

export const maxDuration = 30;
export const POST = route(async (request) => {
  requireCron(request);
  const config = env();
  if (!config.LINE_NOTIFICATIONS_ENABLED || config.LINE_VERIFY_MODE !== "real") return json({ bookings: 0, announcements: 0, disabled: true });
  return json(await drainNotifications());
});
