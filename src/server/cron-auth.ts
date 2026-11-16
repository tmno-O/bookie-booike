import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";

/** Internal endpoints accept only `Authorization: Bearer <CRON_SECRET>`, compared in constant time. */
export function requireCron(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) throw new ApiError(503, "CRON_NOT_CONFIGURED", "Internal job is not configured");
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid cron credentials");
  }
}
