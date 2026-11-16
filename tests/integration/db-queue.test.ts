import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "../../app/api/session/line/route";
import { POST as requestBooking } from "../../app/api/booking-requests/route";
import { GET as readRequest } from "../../app/api/me/booking-requests/[requestId]/route";
import { GET as health } from "../../app/api/health/route";
import { db } from "@/lib/db";
import { drainBookingQueue } from "@/server/services/booking-queue";

// Exercise the Postgres-backed queue used on hosts without a long-running worker.
process.env.QUEUE_DRIVER = "db";

const venueId = randomUUID();
const zoneId = randomUUID();
const tableId = randomUUID();
const slug = `dbq-${venueId}`;
const customers: { cookie: string; customerId: string }[] = [];
const ticketCustomers: string[] = [];
let initialized = false;

function request(method: string, options: { cookie?: string; data?: unknown; key?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.data) headers.set("Content-Type", "application/json");
  if (options.key) headers.set("Idempotency-Key", options.key);
  return new Request("http://localhost/", {
    method, headers, body: options.data ? JSON.stringify(options.data) : undefined,
  });
}

const context = <T>(params: T) => ({ params: Promise.resolve(params) });

function day(offset: number) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short" })
    .format(new Date(Date.now() + offset * 86_400_000));
}

async function book(customer: (typeof customers)[number], serviceDate: string, key = randomUUID()) {
  const response = await requestBooking(request("POST", {
    cookie: customer.cookie, key, data: { venueId, serviceDate, tableId, partySize: 2 },
  }), context({}));
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json() as { requestId: string }).requestId;
}

/** Drain until no request for the test venue is still queued (background drains may be running too). */
async function settle() {
  for (let i = 0; i < 100; i++) {
    await drainBookingQueue({ maxSeconds: 10 });
    const [{ queued }] = await db()<{ queued: number }[]>`
      select count(*)::int as queued from booking_requests where venue_id = ${venueId} and status = 'queued'
    `;
    if (queued === 0) return;
    // Another background/concurrent drain may own the head; let it commit before polling again.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Queue did not settle");
}

function night(serviceDate: string) {
  return db()<{ id: string; status: string; resultCode: string | null; queueSeq: string; decidedAt: Date }[]>`
    select id, status, result_code, queue_seq, decided_at from booking_requests
    where venue_id = ${venueId} and service_date = ${serviceDate} order by queue_seq
  `;
}

beforeAll(async () => {
  if (process.env.LINE_VERIFY_MODE !== "mock" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1") {
    throw new Error("Integration tests require local Supabase and mock LINE mode");
  }
  initialized = true;
  const sql = db();
  await sql`insert into venues (id, slug, name) values (${venueId}, ${slug}, 'DB queue venue')`;
  await sql`insert into venue_line_integrations (venue_id, provider_id, channel_id, liff_id)
    values (${venueId}, ${slug}, '123', '123-dbq')`;
  await sql`insert into zones (id, venue_id, name, capacity) values (${zoneId}, ${venueId}, 'Zone', 12)`;
  await sql`insert into venue_tables (id, venue_id, zone_id, name, capacity) values (${tableId}, ${venueId}, ${zoneId}, 'T1', 4)`;
  for (const name of ["Ann", "Ben", "Cat", "Dan"]) {
    const response = await signIn(request("POST", { data: { venueSlug: slug, idToken: `mock:${name.toLowerCase()}:${name}` } }), context({}));
    expect(response.status, await response.clone().text()).toBe(200);
    const { customerId } = await response.json() as { customerId: string };
    customers.push({ cookie: response.headers.get("set-cookie")!.split(";")[0], customerId });
  }
}, 60_000);

afterAll(async () => {
  if (!initialized) return;
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from notification_outbox where venue_id = ${venueId}`;
      await tx`delete from booking_events where venue_id = ${venueId}`;
      await tx`delete from booking_allocations where venue_id = ${venueId}`;
      await tx`update booking_requests set status = 'queued', booking_id = null, result_code = null where venue_id = ${venueId}`;
      await tx`delete from bookings where venue_id = ${venueId}`;
      await tx`delete from booking_requests where venue_id = ${venueId}`;
      // Test-only cleanup on verified local Supabase; production history stays append-only.
      await tx`alter table audit_logs disable trigger audit_logs_immutable`;
      await tx`delete from audit_logs where venue_id = ${venueId}`;
      await tx`alter table audit_logs enable trigger audit_logs_immutable`;
      await tx`delete from venue_tables where venue_id = ${venueId}`;
      await tx`delete from zones where venue_id = ${venueId}`;
      await tx`delete from venue_customers where venue_id = ${venueId}`;
      for (const id of ticketCustomers) await tx`delete from customers where id = ${id}`;
      const identities = await tx<{ customerId: string }[]>`
        delete from customer_identities where provider_id = ${slug} returning customer_id
      `;
      for (const { customerId } of identities) await tx`delete from customers where id = ${customerId}`;
      await tx`delete from venue_line_integrations where venue_id = ${venueId}`;
      await tx`delete from venues where id = ${venueId}`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}, 20_000);

describe.sequential("Database booking queue", () => {
  it("queues on insert and confirms only the earliest request for a table", async () => {
    const date = day(5);
    const ids = await Promise.all(customers.map((customer) => book(customer, date)));
    await settle();

    // Concurrent inserts can commit out of queue_seq order, so the winner is the first request
    // decided, not necessarily the lowest sequence number (as with SQS, order is arrival in the queue).
    const rows = [...await night(date)].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(rows[0]).toMatchObject({ status: "confirmed", resultCode: null });
    for (const row of rows.slice(1)) expect(row).toMatchObject({ status: "rejected", resultCode: "TABLE_UNAVAILABLE" });

    const winner = customers[ids.indexOf(rows[0].id)];
    const status = await readRequest(request("GET", { cookie: winner.cookie }), context({ requestId: rows[0].id }));
    expect(await status.json()).toMatchObject({ status: "confirmed", bookingId: expect.any(String) });
  });

  it("keeps each night in insert order under concurrent drains", async () => {
    const date = day(6);
    for (const customer of customers) await book(customer, date);
    for (const customer of customers) await book(customer, date);
    await Promise.all([settle(), settle(), settle(), settle()]);

    const rows = await night(date);
    expect(rows).toHaveLength(customers.length * 2);
    expect(rows[0].status).toBe("confirmed");
    expect(rows.filter((row) => row.status === "confirmed")).toHaveLength(1);
    const decided = rows.map((row) => row.decidedAt.getTime());
    expect(decided).toEqual([...decided].sort((a, b) => a - b));
  });

  it("returns the same request for a repeated idempotency key", async () => {
    const key = randomUUID();
    const date = day(7);
    const first = await book(customers[0], date, key);
    expect(await book(customers[0], date, key)).toBe(first);
    await settle();
    expect(await night(date)).toHaveLength(1);
  });

  it("retries a failing request and then rejects it", async () => {
    const sql = db();
    const date = day(8);
    await sql.unsafe(`
      create or replace function public.dbq_fail_${venueId.replaceAll("-", "")}() returns trigger
      language plpgsql as $$ begin raise exception 'forced failure'; end $$;
      create trigger dbq_fail before insert on public.bookings for each row
        when (new.venue_id = '${venueId}') execute function public.dbq_fail_${venueId.replaceAll("-", "")}();
    `);
    try {
      const id = await book(customers[0], date);
      // Each failed attempt ends the run; a background drain from the POST may hold the row briefly.
      for (let i = 0; i < 20; i++) {
        await sql`call drain_booking_requests(10, 5, 2)`;
        const [{ status }] = await sql<{ status: string }[]>`select status from booking_requests where id = ${id}`;
        if (status !== "queued") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const [row] = await sql<{ status: string; resultCode: string | null; attempts: number }[]>`
        select status, result_code, attempts from booking_requests where id = ${id}
      `;
      // A background drain from the POST may also count an attempt.
      expect(row).toMatchObject({ status: "rejected", resultCode: "SYSTEM_ERROR" });
      expect(row.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      await sql.unsafe(`
        drop trigger if exists dbq_fail on public.bookings;
        drop function if exists public.dbq_fail_${venueId.replaceAll("-", "")}();
      `);
    }
  });

  it("skips an exclusive drain while another one is running", async () => {
    const date = day(9);
    const holder = await db().reserve();
    try {
      // Background drains from the POST are exclusive too, so they skip while the lock is held.
      await holder`select pg_advisory_lock(hashtextextended('booking-drain', 5))`;
      const id = await book(customers[1], date);
      await drainBookingQueue({ exclusive: true });
      const [pending] = await db()<{ status: string }[]>`select status from booking_requests where id = ${id}`;
      expect(pending.status).toBe("queued");
    } finally {
      await holder`select pg_advisory_unlock(hashtextextended('booking-drain', 5))`;
      holder.release();
    }
    await drainBookingQueue({ exclusive: true });
    expect((await night(date))[0].status).toBe("confirmed");
  });

  it("reports healthy without SQS and runs housekeeping", async () => {
    const response = await health();
    expect(await response.json()).toMatchObject({ ok: true, checks: { database: true, queue: true }, backlog: { pending: 0, oldestAgeSeconds: 0 } });
    await db()`select booking_housekeeping()`;
  });

  it("audits 50 simultaneous contenders, allocates once, and issues unique concurrent ticket numbers", async () => {
    const date = day(12);
    const ids = await Promise.all(Array.from({ length: 50 }, (_, i) => book(customers[i % customers.length], date)));
    await Promise.all([settle(), settle(), settle()]);
    const rows = await night(date);
    expect(rows).toHaveLength(50);
    expect(rows.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(rows.filter((r) => r.resultCode === "TABLE_UNAVAILABLE")).toHaveLength(49);
    const [allocation] = await db()`select count(*)::int as total from booking_allocations where table_id = ${tableId} and service_date = ${date} and active`;
    expect(allocation.total).toBe(1);
    const events = await db()`select details from audit_logs where venue_id = ${venueId}
      and details->>'service_date' = ${date} and action in ('booking.confirmed', 'booking.rejected')
      order by (details->>'queue_seq')::bigint`;
    expect(events).toHaveLength(50);
    expect(events.map((r) => r.details.request_id).sort()).toEqual([...ids].sort());
    expect(events.map((r) => r.details.queue_seq)).toEqual(rows.map((r) => r.queueSeq));
    for (const { details } of events) {
      expect(details.received_at).toBeTruthy(); expect(details.decided_at).toBeTruthy(); expect(details.result_code).toBeTruthy();
    }
    for (let i = 0; i < 50; i++) {
      const id = randomUUID(); ticketCustomers.push(id);
      await db()`insert into customers (id) values (${id})`;
      await db()`insert into venue_customers (venue_id, customer_id, display_name) values (${venueId}, ${id}, 'Concurrent guest')`;
    }
    const tickets = await Promise.all(ticketCustomers.map((id) => db()`insert into queue_tickets (venue_id, customer_id, contact_name, contact_phone)
      values (${venueId}, ${id}, 'Guest', '0812345678') returning seq`));
    expect(new Set(tickets.map((r) => r[0].seq)).size).toBe(50);
    const [chain] = await db()`select * from verify_audit_chain(${venueId})`;
    expect(chain.firstBadSeq).toBeNull();
  });
});
