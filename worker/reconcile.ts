import { db } from "@/lib/db";
import { reconcilePending } from "./recovery";

async function run() {
  try {
    console.log("Booking requests republished:", await reconcilePending());
  } catch (error) {
    console.error("Booking reconciliation failed", error instanceof Error ? error.name : "UnknownError");
    process.exitCode = 1;
  } finally {
    await db().end({ timeout: 5 });
  }
}

void run().catch(() => { process.exitCode = 1; });
