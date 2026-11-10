import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ChangeMessageVisibilityCommand, CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "../../app/api/session/line/route";
import { POST as logout } from "../../app/api/session/logout/route";
import { POST as requestBooking } from "../../app/api/booking-requests/route";
import { GET as readRequest } from "../../app/api/me/booking-requests/[requestId]/route";
import { GET as readBooking } from "../../app/api/me/bookings/[bookingId]/route";
import { POST as cancel } from "../../app/api/me/bookings/[bookingId]/cancel/route";
import { GET as staffVenue } from "../../app/api/staff/venues/[venueId]/route";
import { PATCH as patchSettings } from "../../app/api/staff/venues/[venueId]/settings/route";
import { PATCH as patchRules } from "../../app/api/staff/venues/[venueId]/rules/route";
import { DELETE as closeTable } from "../../app/api/staff/venues/[venueId]/tables/[tableId]/route";
import { GET as search } from "../../app/api/staff/venues/[venueId]/customers/route";
import { POST as staffBooking } from "../../app/api/staff/venues/[venueId]/booking-requests/route";
import { PATCH as staffCancel } from "../../app/api/staff/venues/[venueId]/bookings/[bookingId]/route";
import { db } from "@/lib/db";
import { sqs } from "@/lib/sqs";
import { consumeBookingMessage, receiveBookingMessage } from "../../worker/consume";
import { reconcilePending } from "../../worker/recovery";

const venueId = randomUUID();
const otherVenueId = randomUUID();
const zoneId = randomUUID();
const tableId = randomUUID();
const smallTableId = randomUUID();
const venueSlug = `test-${venueId}`;
const otherSlug = `test-${otherVenueId}`;
const venues = [venueId, otherVenueId];
const ownerId = "90000000-0000-4000-8000-000000000001";
const staffId = "90000000-0000-4000-8000-000000000002";
let queueUrl = "";
let ownerToken = "";
let staffToken = "";
let alice: { cookie: string; customerId: string };
let bob: typeof alice;
let other: typeof alice;

function request(method: string, options: { cookie?: string; token?: string; data?: unknown; key?: string; path?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.data) headers.set("Content-Type", "application/json");
  if (options.key) headers.set("Idempotency-Key", options.key);
  return new Request(`http://localhost${options.path ?? "/"}`, {
    method, headers, body: options.data ? JSON.stringify(options.data) : undefined,
  });
}

function context<T>(params: T) {
  return { params: Promise.resolve(params) };
}

function day(offset: number) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short" })
    .format(new Date(Date.now() + offset * 86_400_000));
}

async function login(slug: string, subject: string, name: string) {
  const response = await signIn(request("POST", { data: { venueSlug: slug, idToken: `mock:${subject}:${name}` } }), context({}));
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  const { customerId } = await response.json();
  return { cookie: cookie.split(";")[0], customerId };
}

function book(date: string, cookie = alice.cookie, key = randomUUID().toString(), partySize = 4) {
  return requestBooking(request("POST", {
    cookie, key, data: { venueId, serviceDate: date, tableId, partySize, contactPhone: "0812345678" },
  }), context({}));
}

async function getStatus(requestId: string, cookie = alice.cookie) {
  const response = await readRequest(request("GET", { cookie }), context({ requestId }));
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

async function nextMessage() {
  const message = await receiveBookingMessage(AbortSignal.timeout(8_000));
  expect(message).toBeDefined();
  return message!;
}

async function redeliver(receiptHandle: string) {
  await sqs().send(new ChangeMessageVisibilityCommand({
    QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: 0,
  }));
}

beforeAll(async () => {
  const endpoint = process.env.SQS_ENDPOINT;
  if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1" ||
      process.env.LINE_VERIFY_MODE !== "mock" || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" ||
      new URL(process.env.SUPABASE_URL!).hostname !== "127.0.0.1") {
    throw new Error("Integration tests require local Supabase, ElasticMQ and mock LINE mode");
  }

  const config = { region: process.env.SQS_REGION ?? "us-east-1", endpoint,
    credentials: { accessKeyId: "elasticmq", secretAccessKey: "elasticmq" } };
  const { SQSClient } = await import("@aws-sdk/client-sqs");
  const setupQueue = new SQSClient(config);
  try {
    const created = await setupQueue.send(new CreateQueueCommand({
      QueueName: `test-${venueId}.fifo`, Attributes: { FifoQueue: "true" },
    }));
    queueUrl = created.QueueUrl!;
    process.env.SQS_QUEUE_URL = queueUrl;
  } finally {
    setupQueue.destroy();
  }

  const sql = db();
  await sql`insert into venues (id, slug, name) values
    (${venueId}, ${venueSlug}, 'Integration venue'), (${otherVenueId}, ${otherSlug}, 'Other venue')`;
  await sql`insert into venue_line_integrations (venue_id, provider_id, channel_id, liff_id) values
    (${venueId}, ${venueSlug}, '123', '123-abc'), (${otherVenueId}, ${venueSlug}, '123', '123-def')`;
  await sql`insert into zones (id, venue_id, name, capacity) values (${zoneId}, ${venueId}, 'Zone', 12)`;
  await sql`insert into venue_tables (id, venue_id, zone_id, name, capacity) values
    (${tableId}, ${venueId}, ${zoneId}, 'Table 4', 4), (${smallTableId}, ${venueId}, ${zoneId}, 'Table 2', 2)`;
  await sql`insert into venue_members (venue_id, user_id, role) values
    (${venueId}, ${ownerId}, 'owner'), (${venueId}, ${staffId}, 'staff')`;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const [email, setToken] of [
    ["owner@bookie.test", (token: string) => { ownerToken = token; }],
    ["staff@bookie.test", (token: string) => { staffToken = token; }],
  ] as const) {
    const result = await supabase.auth.signInWithPassword({ email, password: "BookieDemo123!" });
    if (result.error) throw new Error(`Demo staff sign-in failed: ${result.error.message}`);
    setToken(result.data.session.access_token);
  }

  alice = await login(venueSlug, "alice", "Alice");
  bob = await login(venueSlug, "bob", "Bob");
  other = await login(otherSlug, "alice", "Alice");
}, 60_000);

afterAll(async () => {
  if (!queueUrl) return;
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`delete from notification_outbox where venue_id in ${tx(venues)}`;
      await tx`delete from booking_events where venue_id in ${tx(venues)}`;
      await tx`delete from booking_allocations where venue_id in ${tx(venues)}`;
      await tx`update booking_requests set status = 'queued', booking_id = null, result_code = null where venue_id in ${tx(venues)}`;
      await tx`delete from bookings where venue_id in ${tx(venues)}`;
      await tx`delete from booking_requests where venue_id in ${tx(venues)}`;
      await tx`delete from audit_logs where venue_id in ${tx(venues)}`;
      await tx`delete from booking_rules where venue_id in ${tx(venues)}`;
      await tx`delete from booking_releases where venue_id in ${tx(venues)}`;
      await tx`delete from venue_tables where venue_id in ${tx(venues)}`;
      await tx`delete from zones where venue_id in ${tx(venues)}`;
      await tx`delete from venue_customers where venue_id in ${tx(venues)}`;
      const identities = await tx<{ customerId: string }[]>`
        delete from customer_identities where provider_id = ${venueSlug} returning customer_id
      `;
      for (const { customerId } of identities) await tx`delete from customers where id = ${customerId}`;
      await tx`delete from venue_line_integrations where venue_id in ${tx(venues)}`;
      await tx`delete from venue_members where venue_id in ${tx(venues)}`;
      await tx`delete from venues where id in ${tx(venues)}`;
    });
  } finally {
    await sqs().send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    sqs().destroy();
    await sql.end({ timeout: 5 });
  }
}, 20_000);

describe.sequential("Supabase + ElasticMQ booking", () => {
  it("isolates tenant sessions, staff roles and public database access", async () => {
    expect(alice.customerId).toBe(other.customerId);
    expect(bob.customerId).not.toBe(alice.customerId);
    expect((await book(day(1), other.cookie)).status).toBe(404);
    expect((await staffVenue(request("GET", { token: staffToken }), context({ venueId: otherVenueId }))).status).toBe(404);
    expect((await patchSettings(request("PATCH", {
      token: staffToken, data: { tableSelectionMode: "auto_assign" },
    }), context({ venueId }))).status).toBe(403);
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
    const direct = await supabase.from("venue_customers").select("customer_id");
    expect(direct.data ?? []).toEqual([]);

    const temporary = await login(venueSlug, "temporary", "Temporary");
    expect((await logout(request("POST", { cookie: temporary.cookie }), context({}))).status).toBe(204);
    expect((await book(day(1), temporary.cookie)).status).toBe(401);
  });

  it("queues 20 contenders with a shared FIFO group and allocates one table", async () => {
    const date = day(2);
    const key = randomUUID().toString();
    const responses = await Promise.all([
      book(date, alice.cookie, key),
      book(date, bob.cookie),
      staffBooking(request("POST", {
        token: staffToken, key: randomUUID(), data: { customerId: bob.customerId, serviceDate: date, tableId, partySize: 4 },
      }), context({ venueId })),
      ...Array.from({ length: 17 }, () => book(date)),
    ]);
    for (const response of responses) expect(response.status, await response.clone().text()).toBe(202);
    const submitted = await Promise.all(responses.map((response) => response.json()));
    const same = await book(date, alice.cookie, key);
    expect(await same.json()).toEqual(submitted[0]);
    expect((await book(date, alice.cookie, key, 3)).status).toBe(422);

    const ordered: string[] = [];
    for (let i = 0; i < 20; i++) {
      const message = await nextMessage();
      expect(message.Attributes?.MessageGroupId).toBe(`${venueId}:${date}`);
      ordered.push(JSON.parse(message.Body!).requestId);
      await consumeBookingMessage(message);
    }
    const results = await db()`select id, status, result_code, booking_id from booking_requests where id in ${db()(ordered)}`;
    expect(new Set(ordered)).toEqual(new Set(submitted.map(({ requestId }) => requestId)));
    expect(results.filter((row) => row.status === "confirmed").map((row) => row.id)).toEqual([ordered[0]]);
    expect(results.filter((row) => row.resultCode === "TABLE_UNAVAILABLE")).toHaveLength(19);
    const first = results.find((row) => row.id === ordered[0])!;
    expect((await readBooking(request("GET", { cookie: other.cookie }), context({ bookingId: first.bookingId }))).status).toBe(404);
    expect((await readRequest(request("GET", { cookie: bob.cookie }), context({ requestId: submitted[0].requestId }))).status).toBe(404);
    expect((await readRequest(request("GET", { cookie: other.cookie }), context({ requestId: submitted[0].requestId }))).status).toBe(404);
    const customers = await search(request("GET", { token: staffToken, path: "/?q=5678" }), context({ venueId }));
    expect(await customers.json()).toMatchObject({ customers: expect.arrayContaining([
      { id: alice.customerId, displayName: "Alice", phoneLastFour: "5678" },
    ]) });
  });

  it("serializes concurrent SQL allocation even outside the worker", async () => {
    const date = day(3);
    const responses = await Promise.all([book(date), book(date, bob.cookie)]);
    const requests = await Promise.all(responses.map((response) => response.json()));
    const outcomes = await Promise.all(requests.map(({ requestId }) =>
      db()`select status, result_code from process_booking_request(${requestId})`));
    expect(outcomes.flat().map((row) => row.status).sort()).toEqual(["confirmed", "rejected"]);
    await consumeBookingMessage(await nextMessage());
    await consumeBookingMessage(await nextMessage());
  });

  it("reconciles pending publish and survives delivery loss before and after commit", async () => {
    const date = day(4);
    const sql = db();
    const [pending] = await sql`
      insert into booking_requests (venue_id, customer_id, actor_type, actor_id, source, service_date,
        party_size, table_id, idempotency_key, payload_hash, created_at)
      values (${venueId}, ${alice.customerId}, 'customer', ${alice.customerId}, 'liff', ${date}, 4, ${tableId},
        ${randomUUID()}, 'test', now() - interval '1 minute') returning id
    `;
    expect(await reconcilePending(venueId)).toBe(1);
    const received = await nextMessage();
    // A connection disappearing before commit has the same database effect as this rollback.
    await expect(sql.begin(async (tx) => {
      await tx`select process_booking_request(${pending.id})`;
      throw new Error("connection lost before commit");
    })).rejects.toThrow("connection lost before commit");
    expect((await getStatus(pending.id)).status).toBe("queued");

    await redeliver(received.ReceiptHandle!);
    const redelivery = await nextMessage();
    expect(Number(redelivery.Attributes?.ApproximateReceiveCount)).toBeGreaterThan(1);
    const [decision] = await sql`select booking_id from process_booking_request(${pending.id})`;
    await redeliver(redelivery.ReceiptHandle!);
    await consumeBookingMessage(await nextMessage());
    expect(await getStatus(pending.id)).toMatchObject({ status: "confirmed", bookingId: decision.bookingId });
    const [count] = await sql`select count(*)::int as count from booking_events where booking_id = ${decision.bookingId}`;
    expect(count.count).toBe(1);
  });

  it("uses versioned rules across midnight and auto-assigns the smallest eligible table", async () => {
    for (const rule of [
      { scope: "venue", serviceStart: "19:00", serviceEnd: "03:00", openWeekdays: [0, 1, 2, 3, 4, 5, 6] },
      { scope: "zone", scopeId: zoneId, minNoticeMinutes: 15 },
      { scope: "table", scopeId: smallTableId, minNoticeMinutes: 5 },
      { scope: "table", scopeId: smallTableId, minNoticeMinutes: 10 },
    ]) {
      const response = await patchRules(request("PATCH", { token: ownerToken, data: rule }), context({ venueId }));
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const [rule] = await db()`select * from effective_rule(${smallTableId}, '2030-01-01')`;
    expect(rule.minNoticeMinutes).toBe(10);
    expect(rule.startsAt.toISOString()).toBe("2030-01-01T12:00:00.000Z");
    expect(rule.endsAt.toISOString()).toBe("2030-01-01T20:00:00.000Z");
    const [candidate] = await db()`
      select result_code from booking_candidates(
        ${venueId}, '2030-01-01', ${smallTableId}, null, 2, '2030-01-01T18:30:00Z', '2030-01-01T17:30:00Z'
      )
    `;
    expect(candidate.resultCode).toBeNull();

    const settings = await patchSettings(request("PATCH", {
      token: ownerToken, data: { tableSelectionMode: "auto_assign" },
    }), context({ venueId }));
    expect(settings.status, await settings.clone().text()).toBe(200);
    const response = await requestBooking(request("POST", {
      cookie: alice.cookie, key: randomUUID(),
      data: { venueId, serviceDate: day(5), zoneId, partySize: 2 },
    }), context({}));
    expect(response.status, await response.clone().text()).toBe(202);
    const { requestId } = await response.json();
    await consumeBookingMessage(await nextMessage());
    const { bookingId } = await getStatus(requestId);
    const detail = await readBooking(request("GET", { cookie: alice.cookie }), context({ bookingId }));
    expect(await detail.json()).toMatchObject({ id: bookingId, tableId: smallTableId, serviceDate: day(5) });
    expect((await patchSettings(request("PATCH", {
      token: ownerToken, data: { tableSelectionMode: "customer_picks" },
    }), context({ venueId }))).status).toBe(200);
  });

  it("cancels atomically, enforces cutoff and preserves bookings when closing a table", async () => {
    const date = day(6);
    const submitted = await book(date);
    expect(submitted.status, await submitted.clone().text()).toBe(202);
    const { requestId } = await submitted.json();
    await consumeBookingMessage(await nextMessage());
    const { bookingId } = await getStatus(requestId);
    const denied = await cancel(request("POST", { cookie: bob.cookie }), context({ bookingId }));
    expect(denied.status).toBe(404);
    const cancelled = await cancel(request("POST", { cookie: alice.cookie }), context({ bookingId }));
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
    expect((await cancel(request("POST", { cookie: alice.cookie }), context({ bookingId }))).status).toBe(200);

    const again = await book(date);
    const second = await again.json();
    await consumeBookingMessage(await nextMessage());
    const replacement = await getStatus(second.requestId);
    expect(replacement.status).toBe("confirmed");
    expect((await closeTable(request("DELETE", { token: staffToken }), context({ venueId, tableId }))).status).toBe(200);
    expect((await book(day(7))).status).toBe(409);
    expect((await getStatus(second.requestId)).status).toBe("confirmed");
    await db()`update venues set cancel_cutoff_minutes = 20000 where id = ${venueId}`;
    expect((await cancel(request("POST", { cookie: alice.cookie }), context({ bookingId: replacement.bookingId }))).status).toBe(409);
    const staffCancelled = await staffCancel(request("PATCH", {
      token: staffToken, data: { status: "cancelled" },
    }), context({ venueId, bookingId: replacement.bookingId }));
    expect(await staffCancelled.json()).toMatchObject({ status: "cancelled" });
  });
});
