import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { BookingInput } from "@/contracts/booking";
import type { PartyBucket } from "@/contracts/party";
import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, notFound } from "@/lib/errors";
import { sqs, sqsQueueUrl } from "@/lib/sqs";
import { scheduleBookingDrain } from "./booking-queue";
import { upsertStaffContact } from "./staff";

type Actor = { type: "customer" | "staff"; id: string };
type QueueRequest = { id: string; payloadHash: string };

type BookingSubmission = BookingInput & { partyBucket?: PartyBucket; contactName?: string };

export async function createBookingRequest(booking: BookingSubmission, customerId: string | null, actor: Actor, key: string) {
  const { venueId, serviceDate, serviceAt, partySize, tableId, zoneId, partyBucket, contactName, contactPhone } = booking;
  const startsAt = serviceAt ? new Date(serviceAt).toISOString() : null;
  const payload = [customerId, serviceDate, startsAt, partySize, tableId, zoneId, booking.contactPhone];
  // Keep hashes for existing table-based clients stable.
  if (partyBucket) payload.push(null, partyBucket, contactName);
  const payloadHash = sha256(JSON.stringify(payload));
  // With the database queue the request is queued as it is recorded; there is no broker to publish to.
  const queued = env().QUEUE_DRIVER === "db";
  const sql = db();
  const result = await sql.begin(async (tx) => {
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
        values (${scope}, date_trunc('minute', clock_timestamp()), 1)
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
    if (!partyBucket && (venue.tableSelectionMode === "customer_picks") !== Boolean(tableId)) {
      return new ApiError(400, "INVALID_BOOKING_TARGET", "Booking target does not match the venue selection mode");
    }

    if (customerId) {
      const [customer] = await tx`
        select 1 from venue_customers where venue_id = ${venueId} and customer_id = ${customerId}
      `;
      if (!customer) return new ApiError(404, "NOT_FOUND", "Customer not found");
    }

    if (actor.type === "customer") {
      const [schedule] = await tx<{ code: string | null }[]>`
        select booking_window_issue(${venueId}, ${serviceDate}, clock_timestamp()) as code
      `;
      if (schedule.code === "DATE_OUT_OF_RANGE") return new ApiError(422, schedule.code, "วันที่อยู่นอกช่วงเปิดจอง");
      if (schedule.code === "NIGHT_NOT_OPEN") return new ApiError(409, schedule.code, "คืนนี้ยังไม่เปิดรับจอง");
      if (schedule.code) return new ApiError(409, schedule.code, "คืนนี้ปิดรับจองแล้ว");
    }

    if (partyBucket) {
      const [zone] = await tx<{ status: string }[]>`select status from zones where venue_id = ${venueId} and id = ${zoneId!}`;
      if (!zone) return new ApiError(422, "ZONE_NOT_FOUND", "ไม่พบโซน");
      if (zone.status === "closed") return new ApiError(409, "ZONE_CLOSED", "โซนนี้ปิดรับจอง");
    }

    const skipRelease = actor.type === "staff" && Boolean(partyBucket);
    if (partyBucket === "12+") {
      // Large parties may span several tables, so they are checked against the zone rather than one table.
      const [large] = await tx<{ mode: string; code: string | null }[]>`
        select coalesce((select large_party_mode from venue_settings where venue_id = ${venueId}), 'staff_review') as mode,
          zone_fits_party(${venueId}, ${serviceDate}, ${zoneId!}, ${partySize}, clock_timestamp(), ${skipRelease}) as code
      `;
      if (large.mode === "disabled") return new ApiError(409, "LARGE_PARTY_DISABLED", "ร้านไม่รับจองออนไลน์สำหรับกลุ่มเกิน 12 คน กรุณาติดต่อร้าน");
      if (large.code) {
        const code = large.code === "TABLE_UNAVAILABLE" ? "ZONE_FULL" : large.code === "NOT_OPEN_YET" ? "NIGHT_NOT_OPEN" : large.code;
        return new ApiError(409, code, "ไม่มีที่นั่งพอสำหรับกลุ่มนี้ในโซนที่เลือก");
      }
    }
    const candidates = partyBucket === "12+" ? [{ resultCode: null }] : await tx<{ resultCode: string | null }[]>`
      select result_code from booking_candidates_for(
        ${venueId}, ${serviceDate}, ${tableId ?? null}, ${zoneId ?? null}, ${partySize}, ${startsAt},
        clock_timestamp(), ${skipRelease}
      ) order by capacity, id
    `;
    if (!candidates.some((candidate) => candidate.resultCode === null)) {
      const code = candidates[0]?.resultCode ?? "TABLE_UNAVAILABLE";
      return new ApiError(409, partyBucket && code === "TABLE_UNAVAILABLE" ? "ZONE_FULL" : code,
        partyBucket ? "ไม่มีโต๊ะที่รองรับคำขอนี้" : "No eligible table for this request");
    }

    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId) {
      if (!skipRelease || !contactName || !contactPhone) {
        return new ApiError(400, "INVALID_INPUT", "Staff-assisted bookings require a name and phone");
      }
      resolvedCustomerId = await upsertStaffContact(tx, venueId, contactName, contactPhone);
    }
    const phoneLastFour = contactPhone?.slice(-4) ?? null;
    if (phoneLastFour && actor.type === "customer") {
      await tx`update venue_customers set phone_last_four = ${phoneLastFour}
        where venue_id = ${venueId} and customer_id = ${customerId}`;
    }
    // Give same-night submissions their sequence while holding a lock through commit.
    // Otherwise a higher sequence could commit before a lower one and be drained first.
    if (queued) await tx`select pg_advisory_xact_lock(hashtextextended(${`${venueId}:${serviceDate}`}, 8))`;
    const [created] = await tx<QueueRequest[]>`
      insert into booking_requests
        (venue_id, customer_id, actor_type, actor_id, source, service_date, service_at, party_size,
          table_id, zone_id, phone_last_four, idempotency_key, payload_hash, party_bucket,
          contact_name, contact_phone, status, published_at)
      values (${venueId}, ${resolvedCustomerId}, ${actor.type}, ${actor.id},
        ${actor.type === "customer" ? "liff" : "staff_assisted"}, ${serviceDate}, ${startsAt}, ${partySize},
        ${tableId ?? null}, ${zoneId ?? null}, ${phoneLastFour}, ${key}, ${payloadHash},
        ${partyBucket ?? null}, ${contactName ?? null}, ${contactPhone ?? null},
        ${queued ? "queued" : "pending_publish"}, ${queued ? sql`clock_timestamp()` : null})
      returning id, payload_hash
    `;
    return created;
  });
  if (result instanceof ApiError) throw result;
  if (queued) scheduleBookingDrain();
  else await publishBookingRequest(result.id);
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
        QueueUrl: sqsQueueUrl(),
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
