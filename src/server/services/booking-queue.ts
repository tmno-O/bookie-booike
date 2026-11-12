import { after } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

type DrainOptions = { maxItems?: number; maxSeconds?: number; exclusive?: boolean };

/**
 * Decide queued requests in the database (QUEUE_DRIVER=db). Safe to run concurrently with Supabase Cron.
 * An exclusive drain returns at once when another exclusive drain is running, which keeps a burst of
 * requests from holding one connection each.
 */
export async function drainBookingQueue({ maxItems = 500, maxSeconds = 8, exclusive = false }: DrainOptions = {}) {
  await db()`call drain_booking_requests(${maxItems}, ${maxSeconds}, ${env().BOOKING_MAX_RECEIVES}, ${exclusive})`;
}

/** In db mode, decide new requests right after the response is sent; Supabase Cron picks up anything missed. */
export function scheduleBookingDrain() {
  if (env().QUEUE_DRIVER !== "db") return;
  const run = () => drainBookingQueue({ exclusive: true }).catch((error: unknown) => {
    console.error("Booking queue drain failed", error instanceof Error ? error.message : "UnknownError");
  });
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts and tests): run without blocking the caller.
    void run();
  }
}
