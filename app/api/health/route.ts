import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { configIssue } from "@/lib/http";
import { sqs, sqsQueueUrl } from "@/lib/sqs";

export async function GET() {
  const [database, queue] = await Promise.allSettled([
    Promise.resolve().then(() => db()`select count(*)::int as pending,
      coalesce(greatest(0, extract(epoch from (clock_timestamp() - min(received_at))))::double precision, 0) as oldest_age_seconds
      from booking_requests where status in ('pending_publish', 'queued')`),
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
  const backlog = database.status === "fulfilled" ? database.value[0] : null;
  return Response.json({ ok, checks, backlog }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
