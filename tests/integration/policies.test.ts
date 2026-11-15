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
