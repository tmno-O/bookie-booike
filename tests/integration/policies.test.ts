import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/lib/db";
import { zoneAvailability } from "@/server/services/availability";

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
  const [proof] = await tx`select details from audit_logs where entity_id = ${booking.bookingId} and action = 'booking.confirmed'`;
  const [original] = await tx`select reference from bookings where id = ${booking.bookingId}`;
  expect(proof.details.reference).toBe(original.reference);
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
  // Announcing only records the announcement; the audience is queued later in batches, outside the venue lock.
  expect(await tx`select 1 from announcement_outbox where announcement_id = ${first.id}`).toHaveLength(0);
  for (let i = 0; i < 5; i++) if ((await tx`select fanout_announcement(${first.id}, 1) as done`)[0].done) break;
  const [state] = await tx`select fanout_done from release_announcements where id = ${first.id}`;
  expect(state.fanoutDone).toBe(true);
  expect((await tx`select fanout_announcement(${first.id}, 1) as done`)[0].done).toBe(true);
  const recipients = await tx`select customer_id from announcement_outbox where announcement_id = ${first.id}`;
  expect(recipients.map((r) => r.customerId)).toEqual([ids.customer]);
  await tx`insert into venue_closures (venue_id, service_date, created_by) values (${ids.venue}, ${ids.date}, ${randomUUID()})`;
  await expect(tx.savepoint(async (sub) => sub`select announce_release(${ids.venue}, ${ids.date}, 'Other', ${opens}, ${randomUUID()})`)).rejects.toThrow("CLOSED");
}));

it("protects append-only history and detects the first tampered row independently of session timezone", () => fixture(async (tx, ids) => {
  await tx`select process_booking_request(${await submit(tx, ids)})`;
  const verify = () => tx`select * from verify_audit_chain(${ids.venue}, null, null)`;
  expect((await verify())[0]).toMatchObject({ checked: 2, firstBadSeq: null });
  await tx`set local time zone 'Asia/Bangkok'`;
  expect((await verify())[0].firstBadSeq).toBeNull();
  await expect(tx.savepoint(async (sub) => sub`update audit_logs set details = '{}' where venue_id = ${ids.venue}`)).rejects.toThrow("AUDIT_APPEND_ONLY");
  await expect(tx.savepoint(async (sub) => sub`delete from audit_logs where venue_id = ${ids.venue}`)).rejects.toThrow("AUDIT_APPEND_ONLY");
  // Simulate a privileged tamper. The whole fixture, including trigger changes, rolls back.
  await tx`alter table audit_logs disable trigger audit_logs_immutable`;
  await tx`update audit_logs set details = details || '{"result_code":"FORGED"}'::jsonb where venue_id = ${ids.venue} and seq = 2`;
  await tx`alter table audit_logs enable trigger audit_logs_immutable`;
  expect((await verify())[0]).toMatchObject({ checked: 2, firstBadSeq: "2" });
}));

it("retains legacy ticket storage without adding new ticket audit events", () => fixture(async (tx, ids) => {
  const [ticket] = await tx`insert into queue_tickets (venue_id, customer_id, contact_name, contact_phone)
    values (${ids.venue}, ${ids.customer}, 'Guest', '0812345678') returning id, seq`;
  const [saved] = await tx`select status, seq from queue_tickets where id = ${ticket.id}`;
  expect(saved).toMatchObject({ status: "waiting", seq: ticket.seq });
  expect(await tx`select action from audit_logs where venue_id = ${ids.venue}`).toEqual([]);
}));

async function largeRequest(tx: TransactionSql, ids: { venue: string; customer: string; zone: string; date: string }) {
  const [row] = await tx`insert into booking_requests
    (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, zone_id, party_bucket, idempotency_key, payload_hash, status)
    values (${ids.venue}, ${ids.customer}, 'customer', ${ids.customer}, 'liff', ${ids.date}, 15, ${ids.zone}, '12+', ${randomUUID()}, 'test', 'queued')
    returning id`;
  return row.id as string;
}

it("sends 12+ parties to staff review and joins the fewest free tables, or refuses them when the owner disabled it", () => fixture(async (tx, ids) => {
  await tx`update zones set capacity = 36 where id = ${ids.zone}`;
  for (const name of ["T2", "T3"]) {
    await tx`insert into venue_tables (venue_id, zone_id, name, capacity) values (${ids.venue}, ${ids.zone}, ${name}, 12)`;
  }
  const [pending] = await tx`select (process_booking_request(${await largeRequest(tx, ids)})).*`;
  expect(pending.status).toBe("confirmed");
  const [booking] = await tx`select status, table_id from bookings where id = ${pending.bookingId}`;
  expect(booking).toMatchObject({ status: "pending_allocation", tableId: null });
  const staff = "90000000-0000-4000-8000-000000000002";
  await tx`insert into venue_members (venue_id, user_id, role) values (${ids.venue}, ${staff}, 'staff')`;
  const [allocated] = await tx`select allocate_booking(${ids.venue}, ${pending.bookingId}, ${staff}, null) as code`;
  expect(allocated.code).toBe("ALLOCATED");
  const held = await tx`select table_id from booking_allocations where booking_id = ${pending.bookingId} and active`;
  expect(held).toHaveLength(2);
  // 12 seats and one table remain, so another 15-person party cannot fit, but a small party still can.
  const otherGuest = { ...ids, customer: randomUUID() };
  await tx`insert into customers (id) values (${otherGuest.customer})`;
  await tx`insert into venue_customers (venue_id, customer_id, display_name)
    values (${ids.venue}, ${otherGuest.customer}, 'Another guest')`;
  const [full] = await tx`select (process_booking_request(${await largeRequest(tx, otherGuest)})).*`;
  expect(full).toMatchObject({ status: "rejected", resultCode: "ZONE_FULL" });
  const [freeTable] = await tx<{ id: string }[]>`select id from venue_tables
    where zone_id = ${ids.zone} and id not in (select table_id from booking_allocations where active)`;
  const smallRequest = await submit(tx, { ...otherGuest, table: freeTable.id });
  const [small] = await tx`select (process_booking_request(${smallRequest})).*`;
  expect(small.status).toBe("confirmed");
  // Cancelling releases every joined table.
  await tx`select cancel_booking(${ids.venue}, ${pending.bookingId}, 'staff', ${staff})`;
  expect(await tx`select 1 from booking_allocations where booking_id = ${pending.bookingId} and active`).toHaveLength(0);
  await tx`insert into venue_settings (venue_id, large_party_mode) values (${ids.venue}, 'disabled')
    on conflict (venue_id) do update set large_party_mode = 'disabled'`;
  const [refused] = await tx`select (process_booking_request(${await largeRequest(tx, ids)})).*`;
  expect(refused).toMatchObject({ status: "rejected", resultCode: "LARGE_PARTY_DISABLED" });
}));

it("keeps check-in open after midnight until the service night ends", () => fixture(async (tx, ids) => {
  const at = (date: string, time: string) => `${date}T${time}+07:00`;
  const [next] = await tx`select to_char(${ids.date}::date + 1, 'YYYY-MM-DD') as d, to_char(${ids.date}::date - 1, 'YYYY-MM-DD') as p`;
  const open = async (time: string) => (await tx`select check_in_open(${ids.table}, ${ids.date}, ${time}::timestamptz) as ok`)[0].ok;
  expect(await open(at(ids.date, "19:00:00"))).toBe(true);
  expect(await open(at(next.d, "00:30:00"))).toBe(true);
  expect(await open(at(next.d, "01:59:00"))).toBe(true);
  expect(await open(at(next.d, "02:00:00"))).toBe(false);
  expect(await open(at(next.p, "23:00:00"))).toBe(false);
}));

it("refuses an allocation whose night differs from its booking", () => fixture(async (tx, ids) => {
  const [booking] = await tx`select (process_booking_request(${await submit(tx, ids)})).*`;
  await expect(tx.savepoint(async (sub) => sub`insert into booking_allocations (venue_id, booking_id, table_id, service_date)
    values (${ids.venue}, ${booking.bookingId}, ${ids.table}, ${ids.date}::date + 1)`)).rejects.toThrow("ALLOCATION_NIGHT_MISMATCH");
}));

it("fills a zone by seats: party buckets book until too few seats are left for their group", () => fixture(async (tx, ids) => {
  // One 15-seat table in a 15-seat zone: the table no longer limits the zone to one booking.
  await tx`update zones set capacity = 15 where id = ${ids.zone}`;
  await tx`update venue_tables set capacity = 15 where id = ${ids.table}`;
  const sizes = { "1-4": 4, "5-8": 8, "9-12": 12 } as const;
  const book = async (party: keyof typeof sizes) => {
    const customer = randomUUID();
    await tx`insert into customers (id) values (${customer})`;
    await tx`insert into venue_customers (venue_id, customer_id, display_name) values (${ids.venue}, ${customer}, 'Guest')`;
    const [row] = await tx`insert into booking_requests
      (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, zone_id, party_bucket,
        contact_name, contact_phone, idempotency_key, payload_hash, status)
      values (${ids.venue}, ${customer}, 'customer', ${customer}, 'liff', ${ids.date}, ${sizes[party]}, ${ids.zone}, ${party},
        'Guest', '0812345678', ${randomUUID()}, 'test', 'queued') returning id`;
    const [decided] = await tx`select (process_booking_request(${row.id})).*`;
    return decided;
  };
  const zone = async (party: keyof typeof sizes) => (await zoneAvailability(tx, ids.venue, ids.date, sizes[party]))[0];

  expect(await book("1-4")).toMatchObject({ status: "confirmed" });
  expect(await book("1-4")).toMatchObject({ status: "confirmed" });
  // 7 of 15 seats are left: a 1-4 group still fits, a 5-8 group does not and its zone is shown unavailable.
  expect(await zone("1-4")).toMatchObject({ seatsLeft: 7, tablesLeft: 1, available: true });
  expect(await zone("5-8")).toMatchObject({ seatsLeft: 7, tablesLeft: 0, available: false });
  expect(await book("5-8")).toMatchObject({ status: "rejected", resultCode: "ZONE_FULL" });
  expect(await book("1-4")).toMatchObject({ status: "confirmed" });
  expect(await zone("1-4")).toMatchObject({ seatsLeft: 3, tablesLeft: 0, available: false });
  expect(await book("1-4")).toMatchObject({ status: "rejected", resultCode: "ZONE_FULL" });
  expect(await tx`select 1 from booking_allocations where table_id = ${ids.table} and active`).toHaveLength(0);
}));
