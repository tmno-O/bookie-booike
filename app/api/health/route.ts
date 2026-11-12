import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sqs, sqsQueueUrl } from "@/lib/sqs";

export async function GET() {
  const [database, queue] = await Promise.allSettled([
    Promise.resolve().then(() => db()`select 1`),
    // The database queue lives in Postgres, so the database check covers it.
    Promise.resolve().then(() => env().QUEUE_DRIVER === "db" ? null : sqs().send(new GetQueueAttributesCommand({
      QueueUrl: sqsQueueUrl(),
      AttributeNames: ["FifoQueue"],
    }), { abortSignal: AbortSignal.timeout(5_000) })),
  ]);
  const checks = { database: database.status === "fulfilled", queue: queue.status === "fulfilled" };
  const ok = checks.database && checks.queue;
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
