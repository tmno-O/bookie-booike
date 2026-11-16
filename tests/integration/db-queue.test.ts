import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as signIn } from "../../app/api/session/line/route";
import { POST as requestBooking } from "../../app/api/booking-requests/route";
import { GET as readRequest } from "../../app/api/me/booking-requests/[requestId]/route";
import { POST as cancel } from "../../app/api/me/bookings/[bookingId]/cancel/route";
import { GET as readBookings } from "../../app/api/me/bookings/route";
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
    cookie: customer.cookie, key, data: { venueId, serviceDate, zoneId, partyBucket: "1-4", contactName: "Guest", contactPhone: "0812345678" },
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
}, 60_000);

async function customer(name = "Contender") {
  const response = await signIn(request("POST", { data: { venueSlug: slug, idToken: `mock:${randomUUID()}:${name}` } }), context({}));
  expect(response.status, await response.clone().text()).toBe(200);
  const { customerId } = await response.json() as { customerId: string };
  return { cookie: response.headers.get("set-cookie")!.split(";")[0], customerId };
}

beforeEach(async () => {
  const newCustomers = await Promise.all(["Ann", "Ben", "Cat", "Dan"].map((name) => customer(name)));
  customers.splice(0, customers.length, ...newCustomers);
});

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

    // Same-night submissions receive their sequence while holding the admission lock through commit.
    const rows = await night(date);
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(rows[0]).toMatchObject({ status: "confirmed", resultCode: null });
    for (const row of rows.slice(1)) expect(row).toMatchObject({ status: "rejected", resultCode: "ZONE_FULL" });

    const winner = customers[ids.indexOf(rows[0].id)];
    const status = await readRequest(request("GET", { cookie: winner.cookie }), context({ requestId: rows[0].id }));
    expect(await status.json()).toMatchObject({ status: "confirmed", bookingId: expect.any(String) });
  });

  it("keeps each night in insert order under concurrent drains", async () => {
    const date = day(6);
    const contenders = [...customers, ...await Promise.all(customers.map(() => customer()))];
    for (const guest of contenders) await book(guest, date);
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

  it("allows just one concurrent request across two nights and frees the quota on cancellation", async () => {
    const [guest, other] = customers;
    const requests = await Promise.all([day(9), day(10)].map((serviceDate) =>
      requestBooking(request("POST", { cookie: guest.cookie, key: randomUUID(),
        data: { venueId, serviceDate, zoneId, partyBucket: "1-4", contactName: "Guest", contactPhone: "0812345678" } }), context({}))));
    expect(requests.map(({ status }) => status).sort()).toEqual([202, 409]);
    expect(await requests.find(({ ok }) => !ok)!.json()).toMatchObject({ error: { code: "ACTIVE_BOOKING_EXISTS" } });
    await settle();

    const active = (cookie: string) => readBookings(new Request("http://localhost/?active=1", { headers: { Cookie: cookie } }), context({}));
    const list = await (await active(guest.cookie)).json();
    expect(list.bookings).toHaveLength(1);
    expect((await (await active(other.cookie)).json()).bookings).toEqual([]);
    const [{ id }] = list.bookings;
    const result = await cancel(request("POST", { cookie: guest.cookie }), context({ bookingId: id }));
    expect(await result.json()).toMatchObject({ status: "cancelled" });
    expect((await (await active(guest.cookie)).json()).bookings).toEqual([]);

    const next = await book(guest, day(11));
    await settle();
    expect((await night(day(11)))[0]).toMatchObject({ id: next, status: "confirmed" });
  });

  it("enforces the quota in SQL even when two requests were already queued", async () => {
    const [{ customerId }] = customers;
    const sql = db();
    const [first, second] = await Promise.all([day(19), day(20)].map(async (date) => (await sql<{ id: string }[]>`
      insert into booking_requests (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, zone_id,
        party_bucket, idempotency_key, payload_hash, status)
      values (${venueId}, ${customerId}, 'customer', ${customerId}, 'liff', ${date}, 4, ${zoneId},
        '1-4', ${randomUUID()}, 'pre-existing', 'queued') returning id`)[0].id));
    const results = await Promise.all([first, second].map(async (id) =>
      (await sql`select status, result_code from process_booking_request(${id})`)[0]));
    expect(results.map((r) => r.status).sort()).toEqual(["confirmed", "rejected"]);
    expect(results.find((r) => r.status === "rejected")?.resultCode).toBe("ACTIVE_BOOKING_EXISTS");
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

  it("audits 50 simultaneous contenders without issuing tickets and allocates once", async () => {
    const date = day(12);
    const guests = await Promise.all(Array.from({ length: 50 }, () => customer()));
    const ids = await Promise.all(guests.map((guest) => book(guest, date)));
    await Promise.all([settle(), settle(), settle()]);
    const rows = await night(date);
    expect(rows).toHaveLength(50);
    expect(rows.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(rows.filter((r) => r.resultCode === "ZONE_FULL")).toHaveLength(49);
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
    const [tickets] = await db()`select count(*)::int as count from queue_tickets where venue_id = ${venueId}`;
    expect(tickets.count).toBe(0);
    const [chain] = await db()`select * from verify_audit_chain(${venueId})`;
    expect(chain.firstBadSeq).toBeNull();
  });
});
