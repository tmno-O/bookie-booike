import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/lib/db";

beforeAll(() => {
  if (new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1") throw new Error("Local database required");
});
afterAll(() => db().end({ timeout: 5 }));

async function fixture(test: (tx: TransactionSql, ids: { venue: string; zone: string; table: string; customer: string; date: string }) => Promise<void>) {
  const rollback = Symbol("rollback fixture");
  try {
    await db().begin(async (tx) => {
      const ids = { venue: randomUUID(), zone: randomUUID(), table: randomUUID(), customer: randomUUID(), date: "" };
      const [day] = await tx`select to_char((now() at time zone 'Asia/Bangkok')::date + 5, 'YYYY-MM-DD') as date`;
      ids.date = day.date;
      await tx`insert into venues (id, slug, name) values (${ids.venue}, ${ids.venue}, 'Policy test')`;
      await tx`insert into zones (id, venue_id, name, capacity) values (${ids.zone}, ${ids.venue}, 'Zone', 12)`;
      await tx`insert into venue_tables (id, venue_id, zone_id, name, capacity) values (${ids.table}, ${ids.venue}, ${ids.zone}, 'T1', 12)`;
      await tx`insert into customers (id) values (${ids.customer})`;
      await tx`insert into venue_customers (venue_id, customer_id, display_name) values (${ids.venue}, ${ids.customer}, 'Guest')`;
      await test(tx, ids);
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
}

async function submit(tx: TransactionSql, ids: { venue: string; customer: string; table: string; date: string }) {
  const [row] = await tx`insert into booking_requests
    (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, table_id, idempotency_key, payload_hash, status)
    values (${ids.venue}, ${ids.customer}, 'customer', ${ids.customer}, 'liff', ${ids.date}, 2, ${ids.table}, ${randomUUID()}, 'test', 'queued') returning id`;
  return row.id as string;
}

it("rejects a queued request after closure, then allows booking after reopening", () => fixture(async (tx, ids) => {
  const request = await submit(tx, ids);
  await tx`insert into venue_closures (venue_id, service_date, reason, created_by) values (${ids.venue}, ${ids.date}, 'Holiday', ${randomUUID()})`;
  const [closed] = await tx`select (process_booking_request(${request})).*`;
  expect(closed).toMatchObject({ status: "rejected", resultCode: "CLOSED" });
  await tx`delete from venue_closures where venue_id = ${ids.venue}`;
  const [open] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  expect(open.status).toBe("confirmed");
}));

it("closed weekdays override table rules and an entirely closed window has no queue opening", () => fixture(async (tx, ids) => {
  await tx`insert into booking_rules (venue_id, scope, version, open_weekdays) values (${ids.venue}, 'venue', 1, array[]::smallint[])`;
  await tx`insert into booking_rules (venue_id, scope, table_id, version, open_weekdays) values (${ids.venue}, 'table', ${ids.table}, 1, array[0,1,2,3,4,5,6]::smallint[])`;
  const [result] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  expect(result.resultCode).toBe("CLOSED");
  const [opening] = await tx`select * from queue_opening(${ids.venue})`;
  expect(opening.opensAt).toBeNull();
}));

it("queue opening skips a closed service night", () => fixture(async (tx, ids) => {
  await tx`insert into venue_settings (venue_id, release_days_before) values (${ids.venue}, 0)`;
  const [day] = await tx`select to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') as date`;
  await tx`insert into venue_closures (venue_id, service_date, created_by) values (${ids.venue}, ${day.date}, ${randomUUID()})`;
  const [opening] = await tx`select opens_at = opens_at_for(${ids.venue}, ${day.date}::date + 1) as correct from queue_opening(${ids.venue})`;
  expect(opening.correct).toBe(true);
}));

it("cancels before cutoff idempotently, releases the table, and records the policy", () => fixture(async (tx, ids) => {
  const [booking] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  const cancel = () => tx`select cancel_booking(${ids.venue}, ${booking.bookingId}, 'customer', ${ids.customer}) as code`;
  expect((await cancel())[0].code).toBe("CANCELLED");
  expect((await cancel())[0].code).toBe("CANCELLED");
  const [event] = await tx`select count(*)::int as total from booking_events where booking_id = ${booking.bookingId} and kind = 'cancelled'`;
  expect(event.total).toBe(1);
  const [audit] = await tx`select details from audit_logs where entity_id = ${booking.bookingId} and action = 'booking.cancelled'`;
  expect(audit.details).toMatchObject({ cutoff_minutes: 120, service_date: ids.date });
  expect(audit.details.deadline).toBeTruthy();
  const [next] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  expect(next.status).toBe("confirmed");
}));

it("enforces disabled policy and cutoff for customers while staff can override both", () => fixture(async (tx, ids) => {
  const [booking] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  await tx`update venues set customer_cancel_enabled = false where id = ${ids.venue}`;
  const cancel = (actor = "customer", id = ids.customer) => tx`select cancel_booking(${ids.venue}, ${booking.bookingId}, ${actor}, ${id}) as code`;
  expect((await cancel())[0].code).toBe("CANCEL_DISABLED");
  expect((await cancel("customer", randomUUID()))[0].code).toBe("NOT_FOUND");
  await tx`update venues set customer_cancel_enabled = true where id = ${ids.venue}`;
  await tx`update bookings set service_at = clock_timestamp() - interval '1 minute' where id = ${booking.bookingId}`;
  expect((await cancel())[0].code).toBe("CUTOFF_PASSED");
  const staff = "90000000-0000-4000-8000-000000000001";
  await tx`insert into venue_members (venue_id, user_id, role) values (${ids.venue}, ${staff}, 'owner')`;
  expect((await cancel("staff", staff))[0].code).toBe("CANCELLED");
}));

it("cancels pending-allocation bookings without creating a table allocation", () => fixture(async (tx, ids) => {
  await tx`insert into venue_settings (venue_id, allocation_mode) values (${ids.venue}, 'manual')`;
  const request = await submit(tx, ids);
  await tx`update booking_requests set table_id = null, zone_id = ${ids.zone}, party_bucket = '1-4', party_size = 4, queue_no = 1 where id = ${request}`;
  const [booking] = await tx`select (process_booking_request(${request})).*`;
  const [state] = await tx`select status from bookings where id = ${booking.bookingId}`;
  expect(state.status).toBe("pending_allocation");
  const [cancelled] = await tx`select cancel_booking(${ids.venue}, ${booking.bookingId}, 'customer', ${ids.customer}) as code`;
  expect(cancelled.code).toBe("CANCELLED");
  const [allocation] = await tx`select count(*)::int as total from booking_allocations where booking_id = ${booking.bookingId}`;
  expect(allocation.total).toBe(0);
}));

it("fans out once only to past bookers, excludes opt-out and new customers, and refuses closed releases", () => fixture(async (tx, ids) => {
  await tx`select process_booking_request(${await submit(tx, ids)})`;
  const opted = randomUUID(), newcomer = randomUUID();
  for (const customer of [opted, newcomer]) {
    await tx`insert into customers (id) values (${customer})`;
    await tx`insert into venue_customers (venue_id, customer_id, display_name) values (${ids.venue}, ${customer}, 'Guest')`;
  }
  // The cancelled winner remains a past booker. Opted-out customer also booked previously.
  const [previous] = await tx`select id from bookings where venue_id = ${ids.venue}`;
  await tx`select cancel_booking(${ids.venue}, ${previous.id}, 'customer', ${ids.customer})`;
  await tx`select process_booking_request(${await submit(tx, { ...ids, customer: opted })})`;
  await tx`update venue_customers set announcements_opt_out = true where venue_id = ${ids.venue} and customer_id = ${opted}`;
  const opens = `${ids.date}T10:00:00Z`;
  await tx`insert into booking_releases (venue_id, service_date, opens_at, title) values (${ids.venue}, ${ids.date}, ${opens}, 'Festival')`;
  const announce = () => tx`select announce_release(${ids.venue}, ${ids.date}, 'Festival', ${opens}, ${randomUUID()}) as id`;
  const [first] = await announce(); const [retry] = await announce();
  expect(retry.id).toBe(first.id);
  const recipients = await tx`select customer_id from announcement_outbox where announcement_id = ${first.id}`;
  expect(recipients.map((r) => r.customerId)).toEqual([ids.customer]);
  await tx`insert into venue_closures (venue_id, service_date, created_by) values (${ids.venue}, ${ids.date}, ${randomUUID()})`;
  await expect(tx.savepoint(async (sub) => sub`select announce_release(${ids.venue}, ${ids.date}, 'Other', ${opens}, ${randomUUID()})`)).rejects.toThrow("CLOSED");
}));
