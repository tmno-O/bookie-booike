import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sqs } from "@/lib/sqs";
import { consumeBookingMessage, receiveBookingMessage } from "./consume";
import { reconcilePending } from "./recovery";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

async function pause(ms: number) {
  await delay(ms, undefined, { signal: shutdown.signal }).catch(() => {});
}

async function poll() {
  while (!shutdown.signal.aborted) {
    try {
      const message = await receiveBookingMessage(shutdown.signal);
      if (message) await consumeBookingMessage(message);
    } catch (error) {
      if (!shutdown.signal.aborted) {
        console.error("Booking consumer will retry", error instanceof Error ? error.name : "UnknownError",
          typeof error === "object" && error && "code" in error ? error.code : undefined);
        await pause(1_000);
      }
    }
  }
}

async function reconcile() {
  while (!shutdown.signal.aborted) {
    try {
      await reconcilePending();
    } catch (error) {
      console.error("Booking reconciliation will retry", error instanceof Error ? error.name : "UnknownError");
    }
    await pause(15_000);
  }
}

async function run() {
  env();
  console.log("Booking worker polling");
  // Each receive takes a single message. The broker gates parallel consumers within a FIFO group.
  await Promise.all([poll(), poll(), poll(), poll(), reconcile()]);
  sqs().destroy();
  await db().end({ timeout: 5 });
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Booking worker failed");
  process.exitCode = 1;
});
