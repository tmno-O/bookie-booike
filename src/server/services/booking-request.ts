import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { BookingInput } from "@/contracts/booking";
import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, notFound } from "@/lib/errors";
import { sqs } from "@/lib/sqs";

type Actor = { type: "customer"; id: string; tokenHash: string } | { type: "staff"; id: string };
type QueueRequest = { id: string; payloadHash: string };

export async function createBookingRequest(booking: BookingInput, customerId: string, actor: Actor, key: string) {
  const { venueId, serviceDate, serviceAt, partySize, tableId, zoneId, contactPhone } = booking;
  const startsAt = serviceAt ? new Date(serviceAt).toISOString() : null;
  const payloadHash = sha256(JSON.stringify([customerId, serviceDate, startsAt, partySize, tableId, zoneId, contactPhone]));
  const result = await db().begin(async (tx) => {
    const scope = `${venueId}:${actor.type}:${actor.id}`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 4))`;
    const [existing] = await tx<QueueRequest[]>`
      select id, payload_hash from booking_requests
      where venue_id = ${venueId} and actor_type = ${actor.type} and actor_id = ${actor.id}
        and idempotency_key = ${key}
    `;
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new ApiError(422, "IDEMPOTENCY_CONFLICT", "Idempotency key already used with a different payload");
      }
      return existing;
    }

    const [rate] = await tx<{ hits: number }[]>`
      insert into booking_rate_limits (scope, window_start, hits)
        values (${actor.type === "customer" ? actor.tokenHash : scope}, date_trunc('minute', clock_timestamp()), 1)
      on conflict (scope, window_start) do update set hits = booking_rate_limits.hits + 1
      where booking_rate_limits.hits < ${env().BOOKING_RATE_LIMIT_PER_MINUTE}
      returning hits
    `;
    if (!rate) throw new ApiError(429, "RATE_LIMITED", "Too many booking requests");

    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${venueId}, 2))`;
    const [venue] = await tx<{ tableSelectionMode: string }[]>`
      select table_selection_mode from venues where id = ${venueId}
    `;
    if (!venue) return new ApiError(404, "NOT_FOUND", "Venue not found");
    if ((venue.tableSelectionMode === "customer_picks") !== Boolean(tableId)) {
      return new ApiError(400, "INVALID_BOOKING_TARGET", "Booking target does not match the venue selection mode");
    }

    const [customer] = await tx`
      select 1 from venue_customers where venue_id = ${venueId} and customer_id = ${customerId}
    `;
    if (!customer) return new ApiError(404, "NOT_FOUND", "Customer not found");

    const candidates = await tx<{ resultCode: string | null }[]>`
      select result_code from booking_candidates(
        ${venueId}, ${serviceDate}, ${tableId ?? null}, ${zoneId ?? null}, ${partySize}, ${startsAt}, clock_timestamp()
      ) order by capacity, id
    `;
    if (!candidates.some((candidate) => candidate.resultCode === null)) {
      return new ApiError(409, candidates[0]?.resultCode ?? "TABLE_UNAVAILABLE", "No eligible table for this request");
    }

    const phoneLastFour = contactPhone?.slice(-4) ?? null;
    if (phoneLastFour && actor.type === "customer") {
      await tx`update venue_customers set phone_last_four = ${phoneLastFour}
        where venue_id = ${venueId} and customer_id = ${customerId}`;
    }
    const [created] = await tx<QueueRequest[]>`
      insert into booking_requests
        (venue_id, customer_id, actor_type, actor_id, source, service_date, service_at, party_size,
          table_id, zone_id, phone_last_four, idempotency_key, payload_hash)
      values (${venueId}, ${customerId}, ${actor.type}, ${actor.id},
        ${actor.type === "customer" ? "liff" : "staff_assisted"}, ${serviceDate}, ${startsAt}, ${partySize},
        ${tableId ?? null}, ${zoneId ?? null}, ${phoneLastFour}, ${key}, ${payloadHash})
      returning id, payload_hash
    `;
    return created;
  });
  if (result instanceof ApiError) throw result;
  await publishBookingRequest(result.id);
  return { requestId: result.id };
}

export async function publishBookingRequest(requestId: string) {
  return db().begin(async (tx) => {
    const [request] = await tx<{ venueId: string; serviceDate: string; status: string }[]>`
      select venue_id, to_char(service_date, 'YYYY-MM-DD') as service_date, status
      from booking_requests where id = ${requestId} for update
    `;
    if (!request || request.status !== "pending_publish") return false;

    try {
      await sqs().send(new SendMessageCommand({
        QueueUrl: env().SQS_QUEUE_URL,
        MessageBody: JSON.stringify({ requestId }),
        MessageGroupId: `${request.venueId}:${request.serviceDate}`,
        MessageDeduplicationId: requestId,
      }), { abortSignal: AbortSignal.timeout(8_000) });
    } catch {
      throw new ApiError(503, "QUEUE_UNAVAILABLE", "Queue unavailable. Retry with the same idempotency key");
    }

    await tx`
      update booking_requests set status = 'queued', published_at = clock_timestamp()
      where id = ${requestId}
    `;
    return true;
  });
}

export async function getBookingRequest(venueId: string, requestId: string, customerId?: string) {
  const sql = db();
  const owner = customerId ? sql`and customer_id = ${customerId}` : sql``;
  const [request] = await sql`
    select id as request_id, status, result_code, booking_id from booking_requests
    where venue_id = ${venueId} and id = ${requestId} ${owner}
  `;
  return request ?? notFound("Booking request");
}
