import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sqs } from "@/lib/sqs";

export async function GET() {
  const [database, queue] = await Promise.allSettled([
    Promise.resolve().then(() => db()`select 1`),
    Promise.resolve().then(() => sqs().send(new GetQueueAttributesCommand({
      QueueUrl: env().SQS_QUEUE_URL,
      AttributeNames: ["FifoQueue"],
    }), { abortSignal: AbortSignal.timeout(5_000) })),
  ]);
  const checks = { database: database.status === "fulfilled", queue: queue.status === "fulfilled" };
  const ok = checks.database && checks.queue;
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
