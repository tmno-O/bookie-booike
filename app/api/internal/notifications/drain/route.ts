import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { drainNotifications } from "@/server/services/notification-drain";

export const maxDuration = 30;
export const POST = route(async (request) => {
  const config = env();
  if (!config.CRON_SECRET) throw new ApiError(503, "CRON_NOT_CONFIGURED", "Notification drain is not configured");
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${config.CRON_SECRET}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiError(401, "UNAUTHORIZED", "Invalid cron credentials");
  if (!config.LINE_NOTIFICATIONS_ENABLED || config.LINE_VERIFY_MODE !== "real") return json({ bookings: 0, announcements: 0, disabled: true });
  return json(await drainNotifications());
});
