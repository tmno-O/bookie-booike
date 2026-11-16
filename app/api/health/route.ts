import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { configIssue } from "@/lib/http";
import { sqs, sqsQueueUrl } from "@/lib/sqs";

export async function GET() {
  const [database, queue, outbox] = await Promise.allSettled([
    Promise.resolve().then(() => db()`select count(*)::int as pending,
      coalesce(greatest(0, extract(epoch from (clock_timestamp() - min(received_at))))::double precision, 0) as oldest_age_seconds
      from booking_requests where status in ('pending_publish', 'queued')`),
    // The database queue lives in Postgres, so the database check covers it.
    Promise.resolve().then(() => env().QUEUE_DRIVER === "db" ? null : sqs().send(new GetQueueAttributesCommand({
      QueueUrl: sqsQueueUrl(),
      AttributeNames: ["FifoQueue"],
    }), { abortSignal: AbortSignal.timeout(5_000) })),
    Promise.resolve().then(() => db()`
      with jobs as (
        select status, coalesce(reminder_at, created_at) as due_since from notification_outbox
        union all select status, created_at from announcement_outbox
        union all select status, reminder_at from announcement_reminder_outbox
      ), states as (
        select status, due_since, (status in ('pending', 'sending', 'scheduled') and due_since <= now()) as pending
        from jobs where status in ('pending', 'sending', 'scheduled', 'dead')
      )
      select count(*) filter (where pending)::int as pending, count(*) filter (where status = 'dead')::int as dead,
        coalesce(extract(epoch from now() - min(due_since) filter (where pending)), 0)::double precision as oldest_pending_age_seconds
      from states
    `),
  ]);
  const checks = { database: database.status === "fulfilled", queue: queue.status === "fulfilled", outbox: outbox.status === "fulfilled" };
  for (const [name, result] of [["database", database], ["queue", queue], ["outbox", outbox]] as const) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      console.error("Health check failed", name, reason instanceof Error ? reason.name : "UnknownError",
        typeof reason === "object" && reason && "code" in reason ? reason.code : undefined, configIssue(reason));
    }
  }
  const ok = checks.database && checks.queue && checks.outbox;
  const backlog = database.status === "fulfilled" ? database.value[0] : null;
  return Response.json({ ok, checks, backlog, outbox: outbox.status === "fulfilled" ? outbox.value[0] : null },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
