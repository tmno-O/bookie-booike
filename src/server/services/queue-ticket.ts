import type { TransactionSql } from "postgres";
import type { z } from "zod";
import type { contactInput, queueTicket } from "@/contracts/queue";
import type { Customer } from "@/lib/auth/customer-session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, notFound } from "@/lib/errors";

type Ticket = z.infer<typeof queueTicket>;

async function ticketStatus(tx: TransactionSql, customer: Customer, id: string) {
  const [ticket] = await tx<Ticket[]>`
    select t.id as request_id, t.status, t.status = 'ready' as ready, r.booking_id, r.id as booking_request_id,
      case when t.status in ('waiting', 'ready') then 1 + (
        select count(*)::int from queue_tickets a where a.venue_id = t.venue_id
          and a.status in ('waiting', 'ready') and a.seq < t.seq
      ) else 0 end as position
    from queue_tickets t
    left join booking_requests r on r.venue_id = t.venue_id and r.ticket_id = t.id
    where t.venue_id = ${customer.venueId} and t.customer_id = ${customer.customerId} and t.id = ${id}
  `;
  return ticket ?? notFound("Queue ticket");
}

export async function issueQueueTicket(customer: Customer, contact: z.infer<typeof contactInput>) {
  const { venueId, customerId, tokenHash } = customer;
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${venueId}, 2))`;
    await tx`select advance_queue(${venueId})`;
    const [existing] = await tx<{ id: string }[]>`
      select id from queue_tickets where venue_id = ${venueId} and customer_id = ${customerId}
        and status in ('waiting', 'ready')
    `;
    if (existing) return { ticket: await ticketStatus(tx, customer, existing.id), created: false };

    const [schedule] = await tx<{ open: boolean }[]>`
      select opens_at <= clock_timestamp() as open from queue_opening(${venueId})
    `;
    if (!schedule?.open) throw new ApiError(403, "NOT_OPEN", "ร้านยังไม่เปิดรับจอง");

    const [rate] = await tx`
      insert into booking_rate_limits (scope, window_start, hits)
      values (${`queue:${tokenHash}`}, date_trunc('minute', clock_timestamp()), 1)
      on conflict (scope, window_start) do update set hits = booking_rate_limits.hits + 1
      where booking_rate_limits.hits < ${env().BOOKING_RATE_LIMIT_PER_MINUTE}
      returning hits
    `;
    if (!rate) throw new ApiError(429, "RATE_LIMITED", "ส่งคำขอเข้าคิวบ่อยเกินไป");

    const [created] = await tx<{ id: string }[]>`
      insert into queue_tickets (venue_id, customer_id, contact_name, contact_phone)
      values (${venueId}, ${customerId}, ${contact.name}, ${contact.phone}) returning id
    `;
    await tx`select advance_queue(${venueId})`;
    return { ticket: await ticketStatus(tx, customer, created.id), created: true };
  });
}

export function getQueueTicket(customer: Customer, id: string) {
  return db().begin(async (tx) => {
    await tx`select advance_queue(${customer.venueId})`;
    return ticketStatus(tx, customer, id);
  });
}

export async function expireQueueTickets(venueId?: string) {
  const sql = db();
  const venue = venueId ? sql`and t.venue_id = ${venueId}` : sql``;
  const due = await sql<{ venueId: string }[]>`
    select distinct t.venue_id from queue_tickets t left join venue_settings s on s.venue_id = t.venue_id
    where t.status = 'ready' and t.ready_at <= now() - make_interval(secs => coalesce(s.ready_ttl_seconds, 120))
    ${venue} order by t.venue_id limit 50
  `;
  for (const { venueId } of due) await sql`select advance_queue(${venueId})`;
}
