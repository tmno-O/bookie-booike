import { after } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Decide queued requests in the database (QUEUE_DRIVER=db). Safe to run concurrently with Supabase Cron. */
export async function drainBookingQueue(maxItems = 50, maxSeconds = 8) {
  await db()`call drain_booking_requests(${maxItems}, ${maxSeconds}, ${env().BOOKING_MAX_RECEIVES})`;
}

/** In db mode, decide new requests right after the response is sent; Supabase Cron picks up anything missed. */
export function scheduleBookingDrain() {
  if (env().QUEUE_DRIVER !== "db") return;
  const run = () => drainBookingQueue().catch((error: unknown) => {
    console.error("Booking queue drain failed", error instanceof Error ? error.message : "UnknownError");
  });
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts and tests): run without blocking the caller.
    void run();
  }
}
