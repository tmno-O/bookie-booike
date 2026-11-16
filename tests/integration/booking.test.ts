import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ChangeMessageVisibilityCommand, CreateQueueCommand, DeleteQueueCommand } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "../../app/api/session/line/route";
import { GET as customerProfile } from "../../app/api/me/route";
import { GET as availability } from "../../app/api/venues/[venueId]/availability/route";
import { GET as publicVenue } from "../../app/api/venues/by-slug/[slug]/route";
import { venueBookingProfile } from "@/contracts/venue";
import { POST as logout } from "../../app/api/session/logout/route";
import { POST as requestBooking } from "../../app/api/booking-requests/route";
import { GET as readRequest } from "../../app/api/me/booking-requests/[requestId]/route";
import { GET as readBookings } from "../../app/api/me/bookings/route";
import { booking as bookingContract } from "@/contracts/booking";
import { GET as readBooking } from "../../app/api/me/bookings/[bookingId]/route";
import { POST as cancel } from "../../app/api/me/bookings/[bookingId]/cancel/route";
import { POST as staffSignIn } from "../../app/api/staff/session/route";
import { POST as staffSignOut } from "../../app/api/staff/session/logout/route";
import { GET as staffMe } from "../../app/api/staff/me/route";
import { staffProfile } from "@/contracts/staff";
import { GET as staffDashboard } from "../../app/api/staff/venues/[venueId]/dashboard/route";
import { GET as staffBookings } from "../../app/api/staff/venues/[venueId]/bookings/route";
import { POST as checkIn } from "../../app/api/staff/venues/[venueId]/bookings/[bookingId]/check-in/route";
import { GET as staffAvailability } from "../../app/api/staff/venues/[venueId]/availability/route";
import { GET as staffRequestStatus } from "../../app/api/staff/venues/[venueId]/booking-requests/[requestId]/route";
import { GET as staffQueue } from "../../app/api/staff/venues/[venueId]/queue/route";
import { GET as staffQueueItem } from "../../app/api/staff/venues/[venueId]/queue/[bookingId]/route";
import { POST as staffAllocate } from "../../app/api/staff/venues/[venueId]/queue/[bookingId]/allocate/route";
import { staffQueueRow } from "@/contracts/queue";
import { POST as createZone, GET as listZones } from "../../app/api/staff/venues/[venueId]/zones/route";
import { PATCH as patchZone } from "../../app/api/staff/venues/[venueId]/zones/[zoneId]/route";
import { POST as createTable } from "../../app/api/staff/venues/[venueId]/tables/route";
import { zoneView } from "@/contracts/venue";
import { GET as hours } from "../../app/api/staff/venues/[venueId]/hours/route";
import { PUT as putHours } from "../../app/api/staff/venues/[venueId]/hours/standard/route";
import { POST as addSpecial } from "../../app/api/staff/venues/[venueId]/hours/special/route";
import { DELETE as deleteSpecial } from "../../app/api/staff/venues/[venueId]/hours/special/[id]/route";
import { hoursData } from "@/contracts/hours";
import { GET as team } from "../../app/api/staff/venues/[venueId]/team/route";
import { POST as invite } from "../../app/api/staff/venues/[venueId]/team/invites/route";
import { DELETE as revokeInvite } from "../../app/api/staff/venues/[venueId]/team/invites/[id]/route";
import { teamData } from "@/contracts/staff";
import { GET as staffBookingDetails } from "../../app/api/staff/venues/[venueId]/bookings/[bookingId]/route";
import { dashboardData } from "@/contracts/staff";
import { GET as staffVenue } from "../../app/api/staff/venues/[venueId]/route";
import { GET as settings, PATCH as patchSettings, PUT as putSettings } from "../../app/api/staff/venues/[venueId]/settings/route";
import { PATCH as patchRules } from "../../app/api/staff/venues/[venueId]/rules/route";
import { PATCH as patchLine } from "../../app/api/staff/venues/[venueId]/line-integration/route";
import { DELETE as closeTable } from "../../app/api/staff/venues/[venueId]/tables/[tableId]/route";
import { GET as search } from "../../app/api/staff/venues/[venueId]/customers/route";
import { POST as staffBooking } from "../../app/api/staff/venues/[venueId]/booking-requests/route";
import { PATCH as staffCancel } from "../../app/api/staff/venues/[venueId]/bookings/[bookingId]/route";
import { db } from "@/lib/db";
import { sqs } from "@/lib/sqs";
import { consumeBookingMessage, receiveBookingMessage } from "../../worker/consume";
import { reconcilePending } from "../../worker/recovery";
import { deliverNextNotification } from "../../worker/notifications";
import { deliverNextAnnouncement } from "../../worker/announcements";
import { encryptSecret } from "@/lib/crypto";
import { GET as announcements } from "../../app/api/me/announcements/route";
import { POST as optOut } from "../../app/api/me/announcements/opt-out/route";
import { GET as auditRead } from "../../app/api/staff/venues/[venueId]/audit/route";
import { GET as auditVerify } from "../../app/api/staff/venues/[venueId]/audit/verify/route";
import { GET as auditExport } from "../../app/api/staff/venues/[venueId]/audit/export.csv/route";
import { GET as auditTimeline } from "../../app/api/staff/venues/[venueId]/bookings/[bookingId]/timeline/route";
import { auditPage } from "@/contracts/audit";

// This suite covers the optional SQS FIFO driver with the Node worker; db-queue.test.ts covers the default.
process.env.QUEUE_DRIVER = "sqs";

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
  const profile = await customerProfile(request("GET", { cookie: cookie.split(";")[0] }), context({}));
  expect(await profile.json()).toEqual({ user: { userId: customerId, displayName: name } });
  return { cookie: cookie.split(";")[0], customerId };
}

function book(date: string, cookie = alice.cookie, key = randomUUID().toString(), contactName = "Alice") {
  return requestBooking(request("POST", {
    cookie, key, data: { venueId, serviceDate: date, zoneId, partyBucket: "1-4", contactName, contactPhone: "0812345678" },
  }), context({}));
}

it("exposes the Bangkok booking schedule and honors a special release", async () => {
  const response = await publicVenue(request("GET"), context({ slug: venueSlug }));
  const venue = venueBookingProfile.parse(await response.json());
  expect(venue).toMatchObject({ id: venueId, today: day(0), open: true, secondsUntilOpen: 0 });
  const date = day(3);
  const instant = `${day(2)}T13:00:00.000Z`;
  await db()`insert into booking_releases (venue_id, service_date, opens_at) values (${venueId}, ${date}, ${instant})`;
  try {
    const [row] = await db()< { opensAt: Date }[] >`select opens_at_for(${venueId}, ${date}) as opens_at`;
    expect(row.opensAt.toISOString()).toBe(instant);
  } finally {
    await db()`delete from booking_releases where venue_id = ${venueId} and service_date = ${date}`;
  }
});

it("submits directly and resolves the last zone table through FIFO", async () => {
  const sql = db();
  const contact = { contactName: "Booker", contactPhone: "0819998888" };
  const date = day(10);
  const availabilityResponse = await availability(request("GET", { path: `/?date=${date}&partyBucket=1-4` }), context({ venueId }));
  expect(await availabilityResponse.json()).toMatchObject({
    nightOpen: true, zones: [{ id: zoneId, available: true, tablesLeft: 1 }],
  });

  const submit = (cookie: string, serviceDate = date, key = randomUUID().toString()) =>
    requestBooking(request("POST", {
      cookie, key, data: { venueId, serviceDate, zoneId, partyBucket: "1-4", ...contact },
    }), context({}));
  const key = randomUUID();
  await sql`insert into booking_releases (venue_id, service_date, opens_at) values (${venueId}, ${date}, now() + interval '1 day')`;
  const early = await submit(alice.cookie, date, key);
  expect(await early.json()).toMatchObject({ error: { code: "NIGHT_NOT_OPEN" } });
  await sql`delete from booking_releases where venue_id = ${venueId} and service_date = ${date}`;

  const responses = await Promise.all([submit(alice.cookie, date, key), submit(bob.cookie)]);
  const accepted = await Promise.all(responses.map(async (response) => {
    expect(response.status, await response.clone().text()).toBe(202);
    return response.json();
  }));
  expect(await (await submit(alice.cookie, date, key)).json()).toEqual(accepted[0]);
  expect((await submit(alice.cookie, day(11), key)).status).toBe(422);

  const first = await nextMessage();
  await consumeBookingMessage(first);
  await consumeBookingMessage(await nextMessage());
  const results = await Promise.all([
    getStatus(accepted[0].requestId, alice.cookie), getStatus(accepted[1].requestId, bob.cookie),
  ]);
  const winner = results.findIndex((result) => result.status === "confirmed");
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(results[winner].requestId).toBe(JSON.parse(first.Body!).requestId);
  expect(results[1 - winner]).toMatchObject({ status: "rejected", resultCode: "ZONE_FULL" });
  const { bookingId } = results[winner];
  const owner = winner === 0 ? alice : bob;
  const booking = await readBooking(request("GET", { cookie: owner.cookie }), context({ bookingId }));
  expect(await booking.json()).toMatchObject({
    tableId, name: contact.contactName, phone: contact.contactPhone, reference: expect.stringMatching(/^BL-\d{4}-\d{4,}$/),
  });

  const setting = await patchSettings(request("PATCH", { token: ownerToken, data: { allocationMode: "manual" } }), context({ venueId }));
  expect(setting.status).toBe(200);
  const manual = await submit(alice.cookie, day(11));
  expect(manual.status, await manual.clone().text()).toBe(202);
  await consumeBookingMessage(await nextMessage());
  const status = await getStatus((await manual.json()).requestId);
  const [pending] = await sql`select status, table_id from bookings where id = ${status.bookingId}`;
  expect(pending).toMatchObject({ status: "pending_allocation", tableId: null });
  const list = await readBookings(request("GET", { cookie: alice.cookie, path: `/?date=${day(11)}&limit=1` }), context({}));
  const { bookings, nextOffset } = await list.json();
  expect(nextOffset).toBeNull();
  expect(bookings.map((entry: unknown) => bookingContract.parse(entry))).toMatchObject([{
    id: status.bookingId, status: "pending_allocation", zoneName: "Zone", party: "1-4",
    name: contact.contactName, phone: contact.contactPhone, source: "liff",
  }]);
  const denied = await readBookings(request("GET", { cookie: bob.cookie, path: `/?date=${day(11)}` }), context({}));
  expect(await denied.json()).toEqual({ bookings: [], nextOffset: null });
  expect(await sql`select booking_id from booking_allocations where booking_id = ${status.bookingId}`).toHaveLength(0);
  await sql`update venue_settings set allocation_mode = 'auto' where venue_id = ${venueId}`;
});

it("authenticates staff cookies, scopes them to one venue and revokes on logout", async () => {
  const data = { email: "owner@bookie.test", password: "BookieDemo123!", venueSlug };
  const cross = request("POST", { data });
  cross.headers.set("Origin", "https://other.test");
  expect((await staffSignIn(cross, context({}))).status).toBe(403);

  const signIn = await staffSignIn(request("POST", { data }), context({}));
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  expect(staffProfile.parse(await signIn.json())).toMatchObject({ staff: { email: data.email, role: "owner" }, venue: { id: venueId } });
  const header = signIn.headers.get("set-cookie")!;
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=lax");
  const cookie = header.split(";")[0];
  expect((await staffMe(request("GET", { cookie }), context({}))).status).toBe(200);
  expect((await staffVenue(request("GET", { cookie }), context({ venueId: otherVenueId }))).status).toBe(404);
  const crossMutation = request("PATCH", { cookie, data: { allocationMode: "manual" } });
  crossMutation.headers.set("Origin", "https://other.test");
  expect((await patchSettings(crossMutation, context({ venueId }))).status).toBe(403);

  const signOut = await staffSignOut(request("POST", { cookie }), context({}));
  expect(signOut.status).toBe(204);
  expect(signOut.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await staffMe(request("GET", { cookie }), context({}))).status).toBe(401);
});

it("reads staff booking details, filters by contact and reference, and counts seats per service night", async () => {
  const date = day(12);
  const response = await book(date);
  expect(response.status, await response.clone().text()).toBe(202);
  await consumeBookingMessage(await nextMessage());
  const { bookingId } = await getStatus((await response.json()).requestId);
  const detail = await staffBookingDetails(request("GET", { token: staffToken }), context({ venueId, bookingId }));
  const booking = bookingContract.parse(await detail.clone().json());
  expect(await detail.json()).toMatchObject({ id: bookingId, canCheckIn: false });

  for (const q of [booking.name, "081 234 5678", booking.reference]) {
    const path = `/?${new URLSearchParams({ date, status: "confirmed", zone: zoneId, q })}`;
    const list = await staffBookings(request("GET", { token: staffToken, path }), context({ venueId }));
    expect(await list.json()).toMatchObject({ serviceDate: date, bookings: [{ id: bookingId }], nextOffset: null });
  }
  const filtered = await staffBookings(request("GET", { token: staffToken, path: `/?date=${date}&status=checked_in` }), context({ venueId }));
  expect(await filtered.json()).toMatchObject({ bookings: [] });
  const dashboard = await staffDashboard(request("GET", { token: staffToken, path: `/?date=${date}` }), context({ venueId }));
  expect(dashboardData.parse(await dashboard.json())).toMatchObject({
    serviceDate: date, metrics: { bookings: 1, guests: 4, pendingRequests: 0, checkedIn: 0 },
    zones: [{ id: zoneId, seats: 12, booked: 4 }],
  });
});

it("checks guests in once on the Bangkok service night without releasing their seats", async () => {
  async function reserve(date: string) {
    const response = await book(date);
    expect(response.status, await response.clone().text()).toBe(202);
    await consumeBookingMessage(await nextMessage());
    return (await getStatus((await response.json()).requestId)).bookingId as string;
  }
  const tomorrow = await reserve(day(1));
  const act = (bookingId: string) => checkIn(request("POST", { token: staffToken }), context({ venueId, bookingId }));
  const early = await act(tomorrow);
  expect(early.status).toBe(409);
  expect(await early.json()).toMatchObject({ error: { code: "NOT_SERVICE_DATE" } });

  const bookingId = await reserve(day(0));
  const attempts = await Promise.all([act(bookingId), act(bookingId)]);
  expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
  expect(await attempts.find((attempt) => attempt.ok)!.json()).toMatchObject({
    status: "checked_in", checkedInAt: expect.any(String), canCheckIn: false,
  });
  expect(await attempts.find((attempt) => !attempt.ok)!.json()).toMatchObject({ error: { code: "ALREADY_CHECKED_IN" } });
  const log = await db()`select id from audit_logs where entity_id = ${bookingId} and action = 'booking.checked_in'`;
  expect(log).toHaveLength(1);
  const result = await cancel(request("POST", { cookie: alice.cookie }), context({ bookingId }));
  expect(await result.json()).toMatchObject({ error: { code: "ALREADY_CHECKED_IN" } });
  const availabilityResponse = await availability(request("GET", { path: `/?date=${day(0)}&partyBucket=1-4` }), context({ venueId }));
  expect(await availabilityResponse.json()).toMatchObject({ zones: [{ id: zoneId, tablesLeft: 0 }] });
});

it("upserts one staff contact by full phone and allocates the last zone table through FIFO", async () => {
  const date = day(13);
  const sql = db();
  await sql`insert into booking_releases (venue_id, service_date, opens_at) values (${venueId}, ${date}, now() + interval '1 day')`;
  const path = `/?date=${date}&partyBucket=1-4`;
  const publicView = await availability(request("GET", { path }), context({ venueId }));
  expect(await publicView.json()).toMatchObject({ nightOpen: false, zones: [{ available: false }] });
  const staffView = await staffAvailability(request("GET", { token: staffToken, path }), context({ venueId }));
  expect(await staffView.json()).toMatchObject({ zones: [{ id: zoneId, available: true, tablesLeft: 1 }] });

  const data = { name: "Assisted Guest", phone: "0817776655", serviceDate: date, party: "1-4", zoneId };
  const submit = (token: string, key: string) => staffBooking(request("POST", { token, key, data }), context({ venueId }));
  const key = randomUUID();
  const submitted = await Promise.all([submit(staffToken, key), submit(ownerToken, randomUUID())]);
  const accepted = await Promise.all(submitted.map(async (response) => {
    expect(response.status, await response.clone().text()).toBe(202);
    return response.json();
  }));
  expect(await (await submit(staffToken, key)).json()).toEqual(accepted[0]);
  await consumeBookingMessage(await nextMessage());
  await consumeBookingMessage(await nextMessage());
  const statuses = await Promise.all(accepted.map(async ({ requestId }) =>
    (await staffRequestStatus(request("GET", { token: staffToken }), context({ venueId, requestId }))).json()));
  expect(statuses.map((status) => status.status).sort()).toEqual(["confirmed", "rejected"]);
  expect(statuses.find((status) => status.status === "rejected").resultCode).toBe("ZONE_FULL");
  const bookingId = statuses.find((status) => status.status === "confirmed").bookingId;
  const booking = await staffBookingDetails(request("GET", { token: staffToken }), context({ venueId, bookingId }));
  expect(await booking.json()).toMatchObject({ name: data.name, phone: data.phone, source: "staff_assisted", tableId });
  expect(await sql`select customer_id from venue_customers where venue_id = ${venueId} and staff_contact_phone = ${data.phone}`).toHaveLength(1);
  expect(await sql`select distinct customer_id from booking_requests where venue_id = ${venueId} and service_date = ${date}`).toHaveLength(1);
});

it("allocates competing pending requests atomically and can move the other to a free zone", async () => {
  const date = day(15);
  const fallbackZoneId = randomUUID();
  const sql = db();
  await sql`insert into zones (id, venue_id, name, capacity) values (${fallbackZoneId}, ${venueId}, 'Fallback', 4)`;
  await sql`insert into venue_tables (venue_id, zone_id, name, capacity) values (${venueId}, ${fallbackZoneId}, 'Fallback table', 4)`;
  await sql`insert into venue_settings (venue_id, allocation_mode) values (${venueId}, 'manual')
    on conflict (venue_id) do update set allocation_mode = 'manual'`;

  const submit = (token: string, phone: string) => staffBooking(request("POST", {
    token, key: randomUUID(), data: { name: "Manual Guest", phone, serviceDate: date, party: "1-4", zoneId },
  }), context({ venueId }));
  const submissions = await Promise.all([submit(staffToken, "0819221111"), submit(ownerToken, "0819222222")]);
  expect(submissions.map((response) => response.status)).toEqual([202, 202]);
  await consumeBookingMessage(await nextMessage());
  await consumeBookingMessage(await nextMessage());
  const getQueue = (status: string) => staffQueue(request("GET", {
    token: staffToken, path: `/?date=${date}&status=${status}`,
  }), context({ venueId }));
  const before = await (await getQueue("pending")).json();
  expect(before.pending).toBe(2);
  const items = before.requests.map((value: unknown) => staffQueueRow.parse(value));
  expect(items.map((row: { queueNo: number }) => row.queueNo)).toEqual([1, 2]);

  const allocate = (bookingId: string, zone?: string) => staffAllocate(request("POST", {
    token: staffToken, data: zone ? { zoneId: zone } : undefined,
  }), context({ venueId, bookingId }));
  const outcomes = await Promise.all(items.map((row: { id: string }) => allocate(row.id)));
  expect(outcomes.map((result) => result.status).sort()).toEqual([200, 409]);
  const winner = outcomes.findIndex((result) => result.ok);
  const [winning, remaining] = [items[winner], items[1 - winner]];
  expect(await outcomes[1 - winner].json()).toMatchObject({ error: { code: "ZONE_FULL" } });
  expect(await (await allocate(winning.id)).json()).toMatchObject({ error: { code: "ALREADY_ALLOCATED" } });

  const detail = await staffQueueItem(request("GET", { token: staffToken }), context({ venueId, bookingId: remaining.id }));
  expect(await detail.json()).toMatchObject({
    request: { status: "pending", zoneId }, zones: expect.arrayContaining([
      { id: zoneId, name: "Zone", available: false, tablesLeft: 0, closed: false },
      { id: fallbackZoneId, name: "Fallback", available: true, tablesLeft: 1, closed: false },
    ]),
  });
  const moved = await allocate(remaining.id, fallbackZoneId);
  expect(await moved.json()).toMatchObject({ request: { id: remaining.id, zoneId: fallbackZoneId, status: "allocated" } });
  expect(await (await getQueue("pending")).json()).toMatchObject({ pending: 0, requests: [] });
  expect(await sql`select id from audit_logs where venue_id = ${venueId} and action = 'booking.allocated'`).toHaveLength(2);
  await sql`update venue_settings set allocation_mode = 'auto' where venue_id = ${venueId}`;
  await sql`update zones set status = 'closed' where id = ${fallbackZoneId}`;
});

it("syncs twelve-seat tables while protecting upcoming reservations and closed zones", async () => {
  const sql = db();
  const create = (name: string) => createZone(request("POST", {
    token: staffToken, data: { name, seats: 25, status: "open" },
  }), context({ venueId }));
  const created = await create("Managed zone");
  expect(created.status, await created.clone().text()).toBe(201);
  const zone = zoneView.parse(await created.json());
  expect(zone).toMatchObject({ seats: 25, tables: 3, status: "active" });
  expect(await (await create("MANAGED ZONE")).json()).toMatchObject({ error: { code: "ZONE_NAME_TAKEN" } });
  const table = await createTable(request("POST", {
    token: staffToken, data: { zoneId: zone.id, name: "Extra", capacity: 12 },
  }), context({ venueId }));
  expect(await table.json()).toMatchObject({ error: { code: "ZONE_SEATS_MANAGED" } });

  const date = day(16);
  const submit = await staffBooking(request("POST", {
    token: staffToken, key: randomUUID(),
    data: { name: "Seat Guest", phone: "0819988776", serviceDate: date, party: "1-4", zoneId: zone.id },
  }), context({ venueId }));
  expect(submit.status, await submit.clone().text()).toBe(202);
  await consumeBookingMessage(await nextMessage());
  const status = await staffRequestStatus(request("GET", { token: staffToken }), context({ venueId, requestId: (await submit.json()).requestId }));
  const { bookingId } = await status.json();
  const [booked] = await sql<{ tableId: string }[]>`select table_id from bookings where id = ${bookingId}`;
  const change = (data: object) => patchZone(request("PATCH", { token: staffToken, data }), context({ venueId, zoneId: zone.id }));
  expect(await (await change({ seats: 3 })).json()).toMatchObject({ error: { code: "CAPACITY_BELOW_BOOKED" } });
  expect(await (await change({ seats: 12 })).json()).toMatchObject({ seats: 12, tables: 1 });
  const tables = await sql`select id, status, capacity from venue_tables where venue_id = ${venueId} and zone_id = ${zone.id}`;
  expect(tables.filter((row) => row.status === "active")).toEqual([{ id: booked.tableId, status: "active", capacity: 12 }]);
  expect(tables.filter((row) => row.status === "closed")).toHaveLength(2);
  expect(await (await change({ status: "closed" })).json()).toMatchObject({ status: "closed", tables: 1 });

  const list = await listZones(request("GET", { token: staffToken, path: `/?date=${date}` }), context({ venueId }));
  expect(await list.json()).toMatchObject({ zones: expect.arrayContaining([
    expect.objectContaining({ id: zone.id, bookedSeats: 4, tablesUsed: 1 }),
  ]) });
  const publicView = await availability(request("GET", { path: `/?date=${date}&partyBucket=1-4` }), context({ venueId }));
  expect(await publicView.json()).toMatchObject({ zones: expect.arrayContaining([
    expect.objectContaining({ id: zone.id, available: false, closed: true }),
  ]) });
});

it("lets only owners edit hours and applies Bangkok special releases to customers", async () => {
  const date = day(24);
  const params = context({ venueId });
  const specialParams = context({ venueId, id: date });
  const owner = { token: ownerToken };
  const denied = { token: staffToken };
  const initial = hoursData.parse(await (await hours(request("GET", owner), params)).json());
  const standard = { daysBefore: 1, time: "19:30" };
  const special = { serviceDate: date, opensOn: day(0), time: "00:00" };
  const visibility = () => availability(request("GET", { path: `/?date=${date}&partyBucket=1-4` }), params);
  for (const response of [
    await hours(request("GET", denied), params),
    await putHours(request("PUT", { ...denied, data: standard }), params),
    await addSpecial(request("POST", { ...denied, data: special }), params),
    await deleteSpecial(request("DELETE", denied), specialParams),
  ]) {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  }

  try {
    expect(await (await putHours(request("PUT", { ...owner, data: standard }), params)).json()).toEqual({ standard });
    expect(await (await visibility()).json()).toMatchObject({ nightOpen: false });
    const added = await addSpecial(request("POST", { ...owner, data: special }), params);
    expect(added.status, await added.clone().text()).toBe(201);
    const opensAt = new Date(`${day(0)}T00:00:00+07:00`).toISOString();
    expect(await added.json()).toMatchObject({ special: { id: date, opensAt } });
    expect(await (await visibility()).json()).toMatchObject({ nightOpen: true, opensAt });
    const snapshot = hoursData.parse(await (await hours(request("GET", owner), params)).json());
    expect(snapshot.specials).toContainEqual({ id: date, opensAt, ...special, title: "", recipients: 0, sent: 0, failed: 0 });
    expect(await (await addSpecial(request("POST", { ...owner, data: special }), params)).json())
      .toMatchObject({ error: { code: "SPECIAL_DAY_EXISTS" } });
    expect((await deleteSpecial(request("DELETE", owner), specialParams)).status).toBe(200);
    expect(await (await visibility()).json()).toMatchObject({ nightOpen: false });
  } finally {
    await putHours(request("PUT", { ...owner, data: initial.standard }), params);
    await db()`delete from booking_releases where venue_id = ${venueId} and service_date = ${date}`;
  }
});

it("publishes owner shop edits and scopes staff invitations to the venue", async () => {
  const params = context({ venueId });
  const owner = { token: ownerToken };
  const staff = { token: staffToken };
  const original = (await (await settings(request("GET", owner), params)).json()).profile;
  const shop = { name: "Updated Venue", phone: "+66 81 234 5678", address: "Bangkok", entryPolicy: "Bring your booking reference" };
  const sendInvite = (email: string, options = owner) =>
    invite(request("POST", { ...options, data: { email, role: "staff" } }), params);

  try {
    for (const denied of [
      await settings(request("GET", staff), params),
      await putSettings(request("PUT", { ...staff, data: shop }), params),
      await sendInvite("pending@example.com", staff),
    ]) {
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
    const saved = await putSettings(request("PUT", { ...owner, data: shop }), params);
    expect(await saved.json()).toEqual({ profile: shop });
    const publicProfile = await publicVenue(request("GET"), context({ slug: venueSlug }));
    expect(await publicProfile.json()).toMatchObject({ shop });
    expect(await (await sendInvite("STAFF@BOOKIE.TEST")).json()).toMatchObject({ error: { code: "ALREADY_MEMBER" } });

    const responses = await Promise.all([sendInvite(" pending@example.com "), sendInvite("PENDING@EXAMPLE.COM")]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await responses.find((response) => !response.ok)!.json()).toMatchObject({ error: { code: "INVITE_EXISTS" } });
    const { invite: savedInvite } = await responses.find((response) => response.ok)!.json();
    const ownerTeam = teamData.parse(await (await team(request("GET", owner), params)).json());
    expect(ownerTeam).toMatchObject({ canEdit: true, invites: [{ id: savedInvite.id, email: "pending@example.com" }] });
    expect(ownerTeam.members.map(({ role }) => role)).toEqual(["owner", "staff"]);
    expect(await (await team(request("GET", staff), params)).json()).toMatchObject({ canEdit: false, invites: [] });

    expect((await revokeInvite(request("DELETE", staff), context({ venueId, id: savedInvite.id }))).status).toBe(403);
    expect((await revokeInvite(request("DELETE", owner), context({ venueId: otherVenueId, id: savedInvite.id }))).status).toBe(404);
    expect(await (await revokeInvite(request("DELETE", owner), context({ venueId, id: savedInvite.id }))).json()).toEqual({ ok: true });
    expect(await (await team(request("GET", owner), params)).json()).toMatchObject({ invites: [] });
  } finally {
    await putSettings(request("PUT", { ...owner, data: original }), params);
  }
});

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

async function crashDuringProcessing(requestId: string, phase: "before_commit" | "after_commit") {
  const child = `
    const sql = require("postgres")(process.env.DATABASE_URL);
    const [requestId, phase] = process.argv.slice(1);
    async function run() {
      await sql.begin(async (tx) => {
        await tx.unsafe("select process_booking_request($1)", [requestId]);
        if (phase === "before_commit") process.exit(42);
      });
      process.exit(42);
    }
    run().catch(() => process.exit(1));
  `;
  await expect(promisify(execFile)(process.execPath, ["-e", child, requestId, phase], { timeout: 8_000 }))
    .rejects.toMatchObject({ code: 42 });
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
      await tx`delete from announcement_reminder_outbox where venue_id in ${tx(venues)}`;
      await tx`delete from announcement_outbox where venue_id in ${tx(venues)}`;
      await tx`delete from release_announcements where venue_id in ${tx(venues)}`;
      await tx`delete from notification_outbox where venue_id in ${tx(venues)}`;
      await tx`delete from booking_events where venue_id in ${tx(venues)}`;
      await tx`delete from booking_allocations where venue_id in ${tx(venues)}`;
      await tx`update booking_requests set status = 'queued', booking_id = null, result_code = null where venue_id in ${tx(venues)}`;
      await tx`delete from bookings where venue_id in ${tx(venues)}`;
      await tx`delete from booking_requests where venue_id in ${tx(venues)}`;
      // Test-only cleanup on verified local Supabase; production history stays append-only.
      await tx`alter table audit_logs disable trigger audit_logs_immutable`;
      await tx`delete from audit_logs where venue_id in ${tx(venues)}`;
      await tx`alter table audit_logs enable trigger audit_logs_immutable`;
      await tx`delete from booking_rules where venue_id in ${tx(venues)}`;
      await tx`delete from booking_releases where venue_id in ${tx(venues)}`;
      await tx`delete from venue_tables where venue_id in ${tx(venues)}`;
      await tx`delete from zones where venue_id in ${tx(venues)}`;
      const staffContacts = await tx<{ customerId: string }[]>`
        delete from venue_customers where venue_id in ${tx(venues)} and staff_contact_phone is not null returning customer_id
      `;
      await tx`delete from venue_customers where venue_id in ${tx(venues)}`;
      for (const { customerId } of staffContacts) await tx`delete from customers where id = ${customerId}`;
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
    expect((await book(date, alice.cookie, key, "Changed name")).status).toBe(422);

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
    expect(results.filter((row) => ["ZONE_FULL", "TABLE_UNAVAILABLE"].includes(row.resultCode))).toHaveLength(19);
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
    await crashDuringProcessing(pending.id, "before_commit");
    expect((await getStatus(pending.id)).status).toBe("queued");

    await redeliver(received.ReceiptHandle!);
    const redelivery = await nextMessage();
    expect(Number(redelivery.Attributes?.ApproximateReceiveCount)).toBeGreaterThan(1);
    await crashDuringProcessing(pending.id, "after_commit");
    const decision = await getStatus(pending.id);
    expect(decision.status).toBe("confirmed");
    await redeliver(redelivery.ReceiptHandle!);
    await consumeBookingMessage(await nextMessage());
    expect(await getStatus(pending.id)).toEqual(decision);
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
    const response = await staffBooking(request("POST", {
      token: staffToken, key: randomUUID(),
      data: { customerId: alice.customerId, serviceDate: day(5), zoneId, partySize: 2 },
    }), context({ venueId }));
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

  it("retries LINE outbox delivery without rolling back the confirmed booking", async () => {
    const sql = db();
    const [job] = await sql`
      select n.id, n.booking_id from notification_outbox n
      join bookings b on b.id = n.booking_id and b.venue_id = n.venue_id
      where n.venue_id = ${venueId} and b.service_date = ${day(4)} and n.kind = 'confirmed'
    `;
    expect(job).toBeDefined();
    await sql`update notification_outbox set status = 'skipped' where venue_id = ${venueId} and id <> ${job.id}`;
    const integration = await patchLine(request("PATCH", {
      token: ownerToken, data: { channelAccessToken: "local-test-token" },
    }), context({ venueId }));
    expect(integration.status, await integration.clone().text()).toBe(200);
    expect(await integration.text()).not.toContain("local-test-token");

    const failed: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("x-line-retry-key")).toBe(job.id);
      expect(JSON.parse(String(init?.body)).to).toBe("alice");
      return new Response(null, { status: 502 });
    };
    expect(await deliverNextNotification(failed, venueId)).toBe(true);
    const [pending] = await sql`select status, attempts, last_error from notification_outbox where id = ${job.id}`;
    expect(pending).toMatchObject({ status: "pending", attempts: 1, lastError: "LINE_HTTP_502" });
    const [booking] = await sql`select status from bookings where id = ${job.bookingId}`;
    expect(booking.status).toBe("confirmed");

    await sql`update notification_outbox set next_attempt_at = now() where id = ${job.id}`;
    const accepted: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("x-line-retry-key")).toBe(job.id);
      return new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "test" } });
    };
    expect(await deliverNextNotification(accepted, venueId)).toBe(true);
    const [sent] = await sql`select status, attempts from notification_outbox where id = ${job.id}`;
    expect(sent).toMatchObject({ status: "sent", attempts: 2 });
  });
});


it("keeps in-app announcements after LINE retry and stops delivery after opt-out", async () => {
  const sql = db();
  await sql`update venue_tables set status = 'active' where id = ${tableId}`;
  const [past] = await sql`insert into booking_requests
    (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, table_id, idempotency_key, payload_hash, status)
    values (${venueId}, ${alice.customerId}, 'customer', ${alice.customerId}, 'liff', ${day(27)}, 2, ${tableId}, ${randomUUID()}, 'announcement-test', 'queued') returning id`;
  await sql`select process_booking_request(${past.id})`;
  const data = { serviceDate: day(29), opensOn: day(0), time: "00:00", title: "Festival", announce: true };
  const response = await addSpecial(request("POST", { token: ownerToken, data }), context({ venueId }));
  expect(response.status, await response.clone().text()).toBe(201);
  const list = () => announcements(request("GET", { cookie: alice.cookie }), context({})).then((r) => r.json());
  expect((await list()).announcements).toContainEqual(expect.objectContaining({ title: "Festival" }));
  expect((await (await announcements(request("GET", { cookie: other.cookie }), context({}))).json()).announcements).toEqual([]);
  await sql`update venue_line_integrations set access_token_ciphertext = ${encryptSecret("token", `${venueId}:access-token`)} where venue_id = ${venueId}`;
  let firstKey = "";
  const retry: typeof fetch = async (url, init) => {
    expect(String(url)).toBe("https://api.line.me/v2/bot/message/multicast");
    firstKey = new Headers(init?.headers).get("X-Line-Retry-Key")!;
    return new Response(null, { status: 503 });
  };
  expect(await deliverNextAnnouncement(retry, venueId)).toBe(true);
  const [leased] = await sql`select count(*)::int as sending from announcement_outbox where venue_id = ${venueId} and status = 'sending'`;
  expect(leased.sending).toBe(0);
  expect((await list()).announcements).toHaveLength(1);
  await sql`update announcement_outbox set next_attempt_at = now() where venue_id = ${venueId} and status = 'pending'`;
  const calls: string[] = [];
  const send: typeof fetch = async (_url, init) => { calls.push(new Headers(init?.headers).get("X-Line-Retry-Key")!); return new Response(null, { status: 200 }); };
  while (await deliverNextAnnouncement(send, venueId)) { /* drain this test audience */ }
  expect(calls.length).toBeGreaterThan(0);
  expect(new Set(calls).size).toBe(calls.length);
  // The failed batch is retried with the same members and the same LINE retry key.
  expect(calls[0]).toBe(firstKey);
  const [delivered] = await sql`select count(*) filter (where status = 'sent')::int as sent,
    count(*) filter (where status in ('pending', 'sending'))::int as open from announcement_outbox where venue_id = ${venueId}`;
  expect(delivered).toMatchObject({ open: 0 });
  expect(delivered.sent).toBeGreaterThan(0);
  expect((await optOut(request("POST", { cookie: alice.cookie, data: { optOut: true } }), context({}))).status).toBe(200);
  expect(await list()).toEqual({ announcements: [], optedOut: true });
});


it("scopes audit evidence, masks phone numbers, restricts exports, and matches customer receipts", async () => {
  const [booking] = await db()`select b.id, b.reference, to_char(b.service_date, 'YYYY-MM-DD') as date
    from bookings b where b.venue_id = ${venueId} and b.customer_id = ${alice.customerId}
      and b.contact_phone = '0812345678' order by b.created_at limit 1`;
  expect(booking).toBeDefined();
  const path = `/api/staff/venues/${venueId}/audit?date=${booking.date}&q=${booking.reference}`;
  const evidence = await auditRead(request("GET", { token: staffToken, path }), context({ venueId }));
  expect(evidence.status, await evidence.clone().text()).toBe(200);
  const data = auditPage.parse(await evidence.json());
  expect(data.entries.length).toBeGreaterThanOrEqual(2);
  expect(data.entries.every((e) => e.phone === '***5678')).toBe(true);
  expect(JSON.stringify(data)).not.toContain('0812345678');
  const receipt = bookingContract.parse(await (await readBooking(request("GET", { cookie: alice.cookie }), context({ bookingId: booking.id }))).json()).receipt;
  expect(receipt).not.toBeNull();
  const timeline = await (await auditTimeline(request("GET", { token: staffToken }), context({ venueId, bookingId: booking.id }))).json();
  expect(timeline.entries).toContainEqual(expect.objectContaining({ action: 'booking.confirmed', rowHash: expect.stringMatching(new RegExp(`^${receipt!.verifyCode}`)) }));
  expect((await auditTimeline(request("GET", { token: staffToken }), context({ venueId: otherVenueId, bookingId: booking.id }))).status).toBe(404);
  expect((await (await auditVerify(request("GET", { token: staffToken }), context({ venueId }))).json()).valid).toBe(true);
  expect((await auditExport(request("GET", { token: staffToken, path }), context({ venueId }))).status).toBe(403);
  const csv = await auditExport(request("GET", { token: ownerToken, path }), context({ venueId }));
  expect(csv.headers.get('content-type')).toContain('text/csv');
  const body = await csv.text(); expect(body).toContain('***5678'); expect(body).not.toContain('0812345678');
});
