import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { configIssue } from "@/lib/http";
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
  for (const [name, result] of [["database", database], ["queue", queue]] as const) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      console.error("Health check failed", name, reason instanceof Error ? reason.name : "UnknownError",
        typeof reason === "object" && reason && "code" in reason ? reason.code : undefined, configIssue(reason));
    }
  }
  const ok = checks.database && checks.queue;
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
