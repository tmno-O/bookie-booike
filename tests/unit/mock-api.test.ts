import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as resetDb } from "../../app/api/mock/reset/route";
import { GET as venue } from "../../app/api/mock/venue/route";
import { POST as joinQueue } from "../../app/api/mock/queue/route";
import { GET as queueStatus } from "../../app/api/mock/queue/[id]/route";
import { GET as availability } from "../../app/api/mock/availability/route";
import { GET as listBookings, POST as book } from "../../app/api/mock/bookings/route";
import { GET as getBooking } from "../../app/api/mock/bookings/[id]/route";
import { POST as lineLogin } from "../../app/api/mock/line/login/route";
import { POST as lineLogout } from "../../app/api/mock/line/logout/route";
import { GET as me } from "../../app/api/mock/me/route";
import { POST as staffLogin } from "../../app/api/mock/admin/login/route";
import { GET as dashboard } from "../../app/api/mock/admin/dashboard/route";
import { POST as staffBook } from "../../app/api/mock/admin/bookings/route";
import { GET as bookingDetail } from "../../app/api/mock/admin/bookings/[id]/route";
import { POST as checkIn } from "../../app/api/mock/admin/bookings/[id]/check-in/route";
import { addDays, today } from "../../src/mock/db";
import { mockIdToken } from "../../src/mock/line";

const dir = await mkdtemp(path.join(tmpdir(), "mock-db-"));
process.env.MOCK_DB_PATH = path.join(dir, "db.json");
afterAll(() => rm(dir, { recursive: true, force: true }));

const call = (handler: (r: Request, c: { params: Promise<never> }) => Promise<Response>, url: string,
  init: { method?: string; body?: unknown; cookie?: string } = {}, params: object = {}) =>
  handler(new Request(`http://t${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.cookie && { cookie: init.cookie }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), { params: Promise.resolve(params as never) });
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const customer = { name: "เจ๊ม่อน", phone: "0919119911" };

async function login(userId = "Umock0001", name = "เจ๊ม่อน") {
  const res = await call(lineLogin, "/api/mock/line/login", { method: "POST", body: { idToken: mockIdToken(userId, name) } });
  return cookieOf(res);
}
async function readyCustomer(userId?: string) {
  const cookie = await login(userId);
  const joined = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie });
  return { requestId: (await joined.json()).requestId as string, cookie };
}
const reserve = (who: { requestId: string; cookie: string }, zoneId: string, party = "1-4") =>
  call(book, "/api/mock/bookings", { method: "POST", cookie: who.cookie,
    body: { requestId: who.requestId, serviceDate: today(), party, zoneId } });

describe("mock LINE login", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });

  it("logs in with a mock LINE token and returns the profile", async () => {
    const cookie = await login("Umock0002", "พี่แมว");
    const res = await call(me, "/api/mock/me", { cookie });
    expect(await res.json()).toEqual({ user: { userId: "Umock0002", displayName: "พี่แมว" } });
  });

  it("rejects a malformed token", async () => {
    const res = await call(lineLogin, "/api/mock/line/login", { method: "POST", body: { idToken: "garbage" } });
    expect(res.status).toBe(401);
  });

  it("requires login for queue and bookings", async () => {
    expect((await call(me, "/api/mock/me")).status).toBe(401);
    expect((await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer })).status).toBe(401);
    expect((await call(listBookings, "/api/mock/bookings", { cookie: "mock_customer=line-Unknown" })).status).toBe(401);
  });

  it("keeps bookings across logins and clears the cookie on logout", async () => {
    const who = await readyCustomer();
    await reserve(who, "zone-indoor");
    const again = await login();
    const list = await (await call(listBookings, "/api/mock/bookings", { cookie: again })).json();
    expect(list.bookings).toHaveLength(1);
    const out = await call(lineLogout, "/api/mock/line/logout", { method: "POST" });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("mock booking API", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });

  it("reports the venue as open", async () => {
    const data = await (await call(venue, "/api/mock/venue")).json();
    expect(data).toMatchObject({ open: true, secondsUntilOpen: 0, today: today() });
  });

  it("rejects joining the queue before opening", async () => {
    await call(resetDb, "/api/mock/reset", { method: "POST", body: { opensInSeconds: 60 } });
    const res = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie: await login() });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_OPEN");
  });

  it("validates customer details", async () => {
    const res = await call(joinQueue, "/api/mock/queue", { method: "POST", body: { name: "x", phone: "123" }, cookie: await login() });
    expect(res.status).toBe(400);
  });

  it("starts at queue position 12 and counts down over time", async () => {
    await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 60 } });
    const cookie = await login();
    const joined = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie });
    expect(await joined.clone().json()).toMatchObject({ status: "waiting", position: 12 });
    const { requestId } = await joined.json();
    const status = await call(queueStatus, `/api/mock/queue/${requestId}`, { cookie }, { id: requestId });
    expect(await status.json()).toMatchObject({ status: "waiting", position: 12 });
  });

  it("returns the same queue entry when joining twice", async () => {
    const cookie = await login();
    const first = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie });
    const again = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie });
    expect(again.status).toBe(200);
    expect((await again.json()).requestId).toBe((await first.json()).requestId);
  });

  it("hides queue entries from other customers", async () => {
    const { requestId } = await readyCustomer();
    const res = await call(queueStatus, `/api/mock/queue/${requestId}`, { cookie: await login("Umock0002", "พี่แมว") }, { id: requestId });
    expect(res.status).toBe(404);
  });

  it("blocks booking until it is the customer's turn", async () => {
    await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 60 } });
    const res = await reserve(await readyCustomer(), "zone-indoor");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_YOUR_TURN");
  });

  it("creates a booking, lists it, and is idempotent", async () => {
    const who = await readyCustomer();
    const created = await reserve(who, "zone-indoor", "5-8");
    expect(created.status).toBe(201);
    const { booking } = await created.json();
    expect(booking).toMatchObject({ zoneName: "Indoor", party: "5-8", name: "เจ๊ม่อน" });
    expect(booking.reference).toMatch(/^BL-\d{4}-0005$/);

    const retry = await reserve(who, "zone-indoor", "5-8");
    expect(retry.status).toBe(200);
    expect((await retry.json()).booking.id).toBe(booking.id);
    expect((await reserve(who, "zone-outdoor")).status).toBe(409);

    const list = await (await call(listBookings, "/api/mock/bookings", { cookie: who.cookie })).json();
    expect(list.bookings).toHaveLength(1);
    const one = await call(getBooking, `/api/mock/bookings/${booking.id}`, { cookie: who.cookie }, { id: booking.id });
    expect((await one.json()).booking.id).toBe(booking.id);
    const other = await call(getBooking, `/api/mock/bookings/${booking.id}`, { cookie: await login("Umock0003", "น้องบี") }, { id: booking.id });
    expect(other.status).toBe(404);
  });

  it("fills a zone: VIP has 2 tables and 1 is pre-booked", async () => {
    const first = await readyCustomer();
    expect((await reserve(first, "zone-vip")).status).toBe(201);
    // a different LINE user joins the queue and tries the same zone
    const res = await reserve(await readyCustomer("Umock0002"), "zone-vip");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ZONE_FULL");

    const avail = await (await call(availability, `/api/mock/availability?date=${today()}`)).json();
    expect(avail.zones.find((z: { id: string }) => z.id === "zone-vip")).toMatchObject({ tablesLeft: 0, available: false });
  });

  it("rejects dates outside the bookable window", async () => {
    const res = await call(availability, "/api/mock/availability?date=2000-01-01");
    expect(res.status).toBe(422);
  });
});

describe("mock admin dashboard", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });
  const staffCookie = async (email = "owner@bookie.test") =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email } }));

  it("requires a staff session", async () => {
    expect((await call(dashboard, "/api/mock/admin/dashboard")).status).toBe(401);
    expect((await call(dashboard, "/api/mock/admin/dashboard", { cookie: await login() })).status).toBe(401);
    const bad = await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email: "x@y.z" } });
    expect(bad.status).toBe(401);
  });

  it("summarises tonight from the seed data", async () => {
    const res = await call(dashboard, "/api/mock/admin/dashboard", { cookie: await staffCookie("staff@bookie.test") });
    const data = await res.json();
    expect(data.metrics).toEqual({ bookings: 4, guests: 35, pendingRequests: 1, checkedIn: 1 });
    expect(data.bookings.map((b: { name: string }) => b.name)).toEqual(["เจ๊ม่อน", "คุณเมย์", "คุณนัท", "คุณแพรว"]);
    expect(data.zones.find((z: { name: string }) => z.name === "Outdoor")).toMatchObject({ booked: 23, seats: 60 });
  });

  it("includes customer bookings and waiting queue requests", async () => {
    const who = await readyCustomer();
    await reserve(who, "zone-indoor", "1-4");
    await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie: await login("Umock0002", "พี่แมว") });
    const data = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie: await staffCookie() })).json();
    expect(data.metrics).toMatchObject({ bookings: 5, pendingRequests: 2 });
    expect(data.bookings.at(-1)).toMatchObject({ name: "เจ๊ม่อน", channel: "line", status: "confirmed", zoneName: "Indoor" });
  });

  it("returns an empty night and rejects a bad date", async () => {
    const cookie = await staffCookie();
    const empty = await (await call(dashboard, "/api/mock/admin/dashboard?date=2030-01-01", { cookie })).json();
    expect(empty.metrics.bookings).toBe(0);
    expect((await call(dashboard, "/api/mock/admin/dashboard?date=tonight", { cookie })).status).toBe(400);
  });

  describe("staff-assisted booking", () => {
    const payload = { name: "คุณใหม่", phone: "0861112222", serviceDate: today(), party: "1-4", zoneId: "zone-indoor" };
    const create = (cookie: string | undefined, body: object = payload) =>
      call(staffBook, "/api/mock/admin/bookings", { method: "POST", body, cookie });

    it("requires a staff session", async () => {
      expect((await create(undefined)).status).toBe(401);
      expect((await create(await login())).status).toBe(401);
    });

    it("creates a confirmed staff booking that shows on the dashboard", async () => {
      const cookie = await staffCookie();
      const res = await create(cookie);
      expect(res.status).toBe(201);
      expect((await res.json()).booking).toMatchObject({ name: "คุณใหม่", channel: "staff", status: "confirmed", zoneName: "Indoor" });
      const data = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
      expect(data.metrics.bookings).toBe(5);
      expect(data.bookings.at(-1)).toMatchObject({ name: "คุณใหม่", channel: "staff" });
    });

    it("shares zone capacity with customer bookings and validates input", async () => {
      const cookie = await staffCookie();
      expect((await create(cookie, { ...payload, zoneId: "zone-vip" })).status).toBe(201); // fills VIP (2 tables)
      const full = await create(cookie, { ...payload, zoneId: "zone-vip" });
      expect(full.status).toBe(409);
      expect((await full.json()).error.code).toBe("ZONE_FULL");
      expect((await reserve(await readyCustomer(), "zone-vip")).status).toBe(409);
      expect((await create(cookie, { ...payload, phone: "12" })).status).toBe(400);
      expect((await create(cookie, { ...payload, serviceDate: "2000-01-01" })).status).toBe(422);
      expect((await create(cookie, { ...payload, zoneId: "nope" })).status).toBe(422);
    });
  });
});

describe("mock booking details and check-in", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });
  const staff = async () =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email: "staff@bookie.test" } }));
  const idOf = async (cookie: string, name: string) => {
    const data = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
    return data.bookings.find((b: { name: string }) => b.name === name).id as string;
  };
  const detail = (cookie: string | undefined, id: string) =>
    call(bookingDetail, `/api/mock/admin/bookings/${id}`, { cookie }, { id });
  const doCheckIn = (cookie: string | undefined, id: string) =>
    call(checkIn, `/api/mock/admin/bookings/${id}/check-in`, { method: "POST", cookie }, { id });

  it("requires staff and returns 404 for unknown bookings", async () => {
    const cookie = await staff();
    const id = await idOf(cookie, "เจ๊ม่อน");
    expect((await detail(undefined, id)).status).toBe(401);
    expect((await detail(await login(), id)).status).toBe(401);
    expect((await doCheckIn(undefined, id)).status).toBe(401);
    expect((await detail(cookie, "missing")).status).toBe(404);
    expect((await doCheckIn(cookie, "missing")).status).toBe(404);
  });

  it("shows booking details", async () => {
    const cookie = await staff();
    const res = await detail(cookie, await idOf(cookie, "เจ๊ม่อน"));
    expect((await res.json()).booking).toMatchObject({
      name: "เจ๊ม่อน", phone: "0919119911", party: "12+", zoneName: "Outdoor", status: "confirmed", canCheckIn: true,
    });
  });

  it("checks in a confirmed or pending booking once and updates the dashboard", async () => {
    const cookie = await staff();
    for (const name of ["เจ๊ม่อน", "คุณเมย์"]) {
      const id = await idOf(cookie, name);
      const res = await doCheckIn(cookie, id);
      expect(res.status).toBe(200);
      expect((await res.json()).booking).toMatchObject({ status: "checked_in", canCheckIn: false });
      const again = await doCheckIn(cookie, id);
      expect(again.status).toBe(409);
      expect((await again.json()).error.code).toBe("ALREADY_CHECKED_IN");
    }
    const data = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
    expect(data.metrics.checkedIn).toBe(3);
    expect(data.metrics.pendingRequests).toBe(0);
  });

  it("only allows check-in on the booked night", async () => {
    const cookie = await staff();
    const made = await call(staffBook, "/api/mock/admin/bookings", { method: "POST", cookie, body: {
      name: "คุณพรุ่งนี้", phone: "0861112222", serviceDate: addDays(today(), 1), party: "1-4", zoneId: "zone-outdoor" } });
    const id = (await made.json()).booking.id;
    expect((await (await detail(cookie, id)).json()).booking.canCheckIn).toBe(false);
    const res = await doCheckIn(cookie, id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_SERVICE_DATE");
  });
});
