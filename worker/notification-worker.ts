import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deliverNextNotification } from "./notifications";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

async function run() {
  const config = env();
  if (!config.LINE_NOTIFICATIONS_ENABLED || config.LINE_VERIFY_MODE !== "real") {
    throw new Error("Enable LINE_NOTIFICATIONS_ENABLED with LINE_VERIFY_MODE=real to send notifications");
  }
  try {
    while (!shutdown.signal.aborted) {
      try {
        if (await deliverNextNotification()) continue;
      } catch (error) {
        console.error("LINE outbox will retry", error instanceof Error ? error.name : "UnknownError");
      }
      await delay(2_000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  } finally {
    await db().end({ timeout: 5 });
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "LINE outbox failed");
  process.exitCode = 1;
});
