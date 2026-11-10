import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { GET as queueList } from "../../app/api/mock/admin/queue/route";
import { GET as queueDetail } from "../../app/api/mock/admin/queue/[id]/route";
import { POST as allocate } from "../../app/api/mock/admin/queue/[id]/allocate/route";
import { GET as zoneList, POST as zoneCreate } from "../../app/api/mock/admin/zones/route";
import { PATCH as zoneEdit } from "../../app/api/mock/admin/zones/[id]/route";
import { GET as hoursGet } from "../../app/api/mock/admin/hours/route";
import { PUT as hoursStandard } from "../../app/api/mock/admin/hours/standard/route";
import { POST as specialCreate } from "../../app/api/mock/admin/hours/special/route";
import { DELETE as specialDelete } from "../../app/api/mock/admin/hours/special/[id]/route";
import { GET as settingsGet, PUT as settingsPut } from "../../app/api/mock/admin/settings/route";
import { GET as teamGet } from "../../app/api/mock/admin/team/route";
import { POST as inviteCreate } from "../../app/api/mock/admin/team/invites/route";
import { DELETE as inviteDelete } from "../../app/api/mock/admin/team/invites/[id]/route";
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
    expect(booking.reference).toMatch(/^BL-\d{4}-0007$/);

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
    expect(data.metrics).toEqual({ bookings: 6, guests: 47, pendingRequests: 3, checkedIn: 1 });
    expect(data.bookings.map((b: { name: string }) => b.name)).toEqual(["เจ๊ม่อน", "คุณเมย์", "คุณนัท", "คุณแพรว", "คุณบาส", "คุณแนน"]);
    expect(data.zones.find((z: { name: string }) => z.name === "Outdoor")).toMatchObject({ booked: 23, seats: 60 });
  });

  it("includes customer bookings and waiting queue requests", async () => {
    const who = await readyCustomer();
    await reserve(who, "zone-indoor", "1-4");
    await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie: await login("Umock0002", "พี่แมว") });
    const data = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie: await staffCookie() })).json();
    expect(data.metrics).toMatchObject({ bookings: 7, pendingRequests: 4 });
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
      expect(data.metrics.bookings).toBe(7);
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
    expect(data.metrics.pendingRequests).toBe(2);
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


describe("mock admin booking queue", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });
  const staff = async () =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email: "staff@bookie.test" } }));
  const list = async (cookie: string, date = "") =>
    (await call(queueList, `/api/mock/admin/queue${date}`, { cookie })).json();
  const alloc = (cookie: string | undefined, id: string, body?: object) =>
    call(allocate, `/api/mock/admin/queue/${id}/allocate`, { method: "POST", cookie, body }, { id });

  it("requires staff", async () => {
    expect((await call(queueList, "/api/mock/admin/queue")).status).toBe(401);
    expect((await call(queueList, "/api/mock/admin/queue", { cookie: await login() })).status).toBe(401);
    expect((await alloc(undefined, "seed-2")).status).toBe(401);
  });

  it("lists customer requests in queue order with pending count", async () => {
    const data = await list(await staff());
    expect(data.pending).toBe(3);
    expect(data.requests.map((r: { queueNo: number; name: string }) => `#${r.queueNo} ${r.name}`)).toEqual(
      ["#9 เจ๊ม่อน", "#11 คุณแพรว", "#12 คุณเมย์", "#13 คุณบาส", "#14 คุณแนน"]);
    expect(data.requests.find((r: { queueNo: number }) => r.queueNo === 12)).toMatchObject({ status: "pending", zoneName: "Indoor", party: "5-8" });
    expect(Date.parse(data.requests[2].requestedAt)).toBeGreaterThan(Date.parse(data.requests[0].requestedAt));
    expect((await list(await staff(), "?date=2030-01-01")).requests).toEqual([]);
  });

  it("numbers new customer requests after the existing ones", async () => {
    const cookie = await staff();
    await reserve(await readyCustomer(), "zone-indoor");
    const data = await list(cookie);
    expect(data.requests.at(-1)).toMatchObject({ queueNo: 15, name: "เจ๊ม่อน", status: "allocated" });
    expect(data.pending).toBe(3);
  });

  it("returns request details and 404 for staff-created or unknown ids", async () => {
    const cookie = await staff();
    const res = await call(queueDetail, "/api/mock/admin/queue/seed-5", { cookie }, { id: "seed-5" });
    expect(await res.json()).toMatchObject({ request: { queueNo: 13, name: "คุณบาส" }, phone: "0856789012" });
    expect((await call(queueDetail, "/api/mock/admin/queue/seed-3", { cookie }, { id: "seed-3" })).status).toBe(404);
    expect((await call(queueDetail, "/api/mock/admin/queue/nope", { cookie }, { id: "nope" })).status).toBe(404);
  });

  it("allocates a pending request once and confirms it in the dashboard", async () => {
    const cookie = await staff();
    const res = await alloc(cookie, "seed-2");
    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ status: "allocated", zoneName: "Indoor" });
    const again = await alloc(cookie, "seed-2");
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ALREADY_ALLOCATED");
    const dash = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
    expect(dash.bookings.find((b: { name: string }) => b.name === "คุณเมย์").status).toBe("confirmed");
    expect(dash.metrics.pendingRequests).toBe(2);
    expect(dash.zones.find((z: { name: string }) => z.name === "Indoor").booked).toBe(8);
  });

  it("pending requests do not hold a table; a full zone blocks allocation until another zone is chosen", async () => {
    const cookie = await staff();
    const avail = (zone: string) => call(availability, `/api/mock/availability?date=${today()}`).then((r) => r.json())
      .then((d) => d.zones.find((z: { id: string }) => z.id === zone));
    expect(await avail("zone-vip")).toMatchObject({ tablesLeft: 1 }); // pending คุณแนน (VIP) does not count
    expect((await reserve(await readyCustomer(), "zone-vip")).status).toBe(201); // VIP now full
    const blocked = await alloc(cookie, "seed-6"); // คุณแนน asked for VIP
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("ZONE_FULL");
    const moved = await alloc(cookie, "seed-6", { zoneId: "zone-indoor" });
    expect(moved.status).toBe(200);
    expect((await moved.json()).request).toMatchObject({ status: "allocated", zoneName: "Indoor" });
    expect((await alloc(cookie, "seed-5", { zoneId: "nope" })).status).toBe(422);
  });
});


describe("mock admin zones", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } }); });
  const owner = async () =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email: "owner@bookie.test" } }));
  const create = (cookie: string | undefined, body: object) =>
    call(zoneCreate, "/api/mock/admin/zones", { method: "POST", cookie, body });
  const edit = (cookie: string | undefined, id: string, body: object) =>
    call(zoneEdit, `/api/mock/admin/zones/${id}`, { method: "PATCH", cookie, body }, { id });
  const customerZones = async () =>
    (await (await call(availability, `/api/mock/availability?date=${today()}`)).json()).zones as
      { id: string; name: string; available: boolean; closed: boolean; tablesLeft: number }[];

  it("requires staff", async () => {
    expect((await call(zoneList, "/api/mock/admin/zones")).status).toBe(401);
    expect((await call(zoneList, "/api/mock/admin/zones", { cookie: await login() })).status).toBe(401);
    expect((await create(undefined, { name: "X", seats: 10, status: "open" })).status).toBe(401);
    expect((await edit(undefined, "zone-vip", { seats: 10 })).status).toBe(401);
  });

  it("lists zones with capacity and seats booked tonight (pending requests excluded)", async () => {
    const data = await (await call(zoneList, "/api/mock/admin/zones", { cookie: await owner() })).json();
    expect(data.zones).toEqual([
      { id: "zone-vip", name: "VIP", seats: 24, status: "open", tables: 2, tablesUsed: 1, bookedSeats: 4 },
      { id: "zone-indoor", name: "Indoor", seats: 48, status: "open", tables: 4, tablesUsed: 0, bookedSeats: 0 },
      { id: "zone-outdoor", name: "Outdoor", seats: 60, status: "open", tables: 5, tablesUsed: 2, bookedSeats: 23 },
    ]);
  });

  it("adds a zone that customers can book, and validates input", async () => {
    const cookie = await owner();
    const made = await create(cookie, { name: "Rooftop", seats: 24, status: "open" });
    expect(made.status).toBe(201);
    const zone = (await made.json()).zone;
    expect(zone).toMatchObject({ name: "Rooftop", seats: 24, tables: 2, tablesUsed: 0 });
    expect((await customerZones()).find((z) => z.id === zone.id)).toMatchObject({ available: true, tablesLeft: 2 });
    expect((await reserve(await readyCustomer(), zone.id)).status).toBe(201);
    const dup = await create(cookie, { name: "rooftop", seats: 10, status: "open" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("ZONE_NAME_TAKEN");
    expect((await create(cookie, { name: "", seats: 10, status: "open" })).status).toBe(400);
    expect((await create(cookie, { name: "Y", seats: 0, status: "open" })).status).toBe(400);
    expect((await create(cookie, { name: "Y", seats: 10, status: "maybe" })).status).toBe(400);
  });

  it("renames a zone everywhere and rejects duplicate names", async () => {
    const cookie = await owner();
    const res = await edit(cookie, "zone-indoor", { name: "Garden" });
    expect((await res.json()).zone.name).toBe("Garden");
    expect((await customerZones()).map((z) => z.name)).toContain("Garden");
    const dash = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
    expect(dash.bookings.find((b: { name: string }) => b.name === "คุณเมย์").zoneName).toBe("Garden");
    const dup = await edit(cookie, "zone-indoor", { name: "vip" });
    expect(dup.status).toBe(409);
    expect((await edit(cookie, "zone-indoor", { name: "Garden" })).status).toBe(200); // same name is fine
    expect((await edit(cookie, "nope", { name: "Z" })).status).toBe(404);
    expect((await edit(cookie, "zone-indoor", {})).status).toBe(400);
  });

  it("changing capacity changes table availability but not below existing bookings", async () => {
    const cookie = await owner();
    expect((await edit(cookie, "zone-vip", { seats: 12 })).status).toBe(200); // 1 table, 1 booked
    expect((await customerZones()).find((z) => z.id === "zone-vip")).toMatchObject({ available: false, tablesLeft: 0 });
    expect((await edit(cookie, "zone-vip", { seats: 36 })).status).toBe(200); // 3 tables
    expect((await customerZones()).find((z) => z.id === "zone-vip")).toMatchObject({ available: true, tablesLeft: 2 });
    await reserve(await readyCustomer(), "zone-vip");
    await reserve(await readyCustomer("Umock0002"), "zone-vip"); // VIP now has 3 bookings
    const low = await edit(cookie, "zone-vip", { seats: 24 });
    expect(low.status).toBe(409);
    expect((await low.json()).error.code).toBe("CAPACITY_BELOW_BOOKED");
  });

  it("closing a zone blocks new customer, staff and allocated bookings but keeps existing ones", async () => {
    const cookie = await owner();
    expect((await edit(cookie, "zone-outdoor", { status: "closed" })).status).toBe(200);
    expect((await customerZones()).find((z) => z.id === "zone-outdoor")).toMatchObject({ available: false, closed: true });
    const blocked = await reserve(await readyCustomer(), "zone-outdoor");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("ZONE_CLOSED");
    const staffRes = await call(staffBook, "/api/mock/admin/bookings", { method: "POST", cookie, body: {
      name: "ปิด", phone: "0861112222", serviceDate: today(), party: "1-4", zoneId: "zone-outdoor" } });
    expect((await staffRes.json()).error.code).toBe("ZONE_CLOSED");
    const alloc = await call(allocate, "/api/mock/admin/queue/seed-5/allocate", { method: "POST", cookie }, { id: "seed-5" });
    expect((await alloc.json()).error.code).toBe("ZONE_CLOSED");
    const dash = await (await call(dashboard, "/api/mock/admin/dashboard", { cookie })).json();
    expect(dash.bookings.find((b: { name: string }) => b.name === "เจ๊ม่อน")).toMatchObject({ zoneName: "Outdoor" });
    expect((await edit(cookie, "zone-outdoor", { status: "open" })).status).toBe(200);
    expect((await customerZones()).find((z) => z.id === "zone-outdoor")?.available).toBe(true);
  });
});


describe("mock admin opening hours", () => {
  // Fixed clock: 2026-11-11 12:00 in Bangkok (05:00 UTC). Only Date is faked so file I/O keeps working.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T05:00:00Z"));
    await call(resetDb, "/api/mock/reset", { method: "POST", body: { queueStepSeconds: 0 } });
  });
  afterEach(() => vi.useRealTimers());

  const as = async (email: string) =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email } }));
  const owner = () => as("owner@bookie.test");
  const staffOnly = () => as("staff@bookie.test");
  const putStandard = (cookie: string | undefined, body: object) =>
    call(hoursStandard, "/api/mock/admin/hours/standard", { method: "PUT", cookie, body });
  const addSpecial = (cookie: string | undefined, body: object) =>
    call(specialCreate, "/api/mock/admin/hours/special", { method: "POST", cookie, body });
  const venueNow = async () => (await call(venue, "/api/mock/venue")).json();
  const nightInfo = async (date: string) =>
    (await call(availability, `/api/mock/availability?date=${date}`)).json();

  it("shows the default schedule; only the owner can edit", async () => {
    const asOwner = await (await call(hoursGet, "/api/mock/admin/hours", { cookie: await owner() })).json();
    expect(asOwner).toMatchObject({ standard: { daysBefore: 1, time: "20:00" }, specials: [], canEdit: true });
    const asStaff = await (await call(hoursGet, "/api/mock/admin/hours", { cookie: await staffOnly() })).json();
    expect(asStaff.canEdit).toBe(false);
    expect((await call(hoursGet, "/api/mock/admin/hours")).status).toBe(401);

    const cookie = await staffOnly();
    expect((await putStandard(cookie, { daysBefore: 2, time: "19:00" })).status).toBe(403);
    expect((await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-24", time: "20:00" })).status).toBe(403);
    expect((await putStandard(undefined, { daysBefore: 2, time: "19:00" })).status).toBe(401);
  });

  it("validates and saves the standard hours", async () => {
    const cookie = await owner();
    for (const bad of [{ daysBefore: 31, time: "20:00" }, { daysBefore: -1, time: "20:00" }, { daysBefore: 1, time: "25:00" },
      { daysBefore: 1.5, time: "20:00" }, { daysBefore: 1 }]) {
      expect((await putStandard(cookie, bad)).status).toBe(400);
    }
    expect((await putStandard(cookie, { daysBefore: 3, time: "18:30" })).status).toBe(200);
    expect((await (await call(hoursGet, "/api/mock/admin/hours", { cookie })).json()).standard).toEqual({ daysBefore: 3, time: "18:30" });
  });

  it("opens each night at the standard time and blocks customers until then", async () => {
    // default: night D opens at 20:00 on D-1, so tonight is open but tomorrow opens at 20:00 today
    expect(await nightInfo("2026-11-11")).toMatchObject({ open: true });
    expect(await nightInfo("2026-11-12")).toMatchObject({ open: false, opensAt: "2026-11-11T13:00:00.000Z" });
    const who = await readyCustomer();
    const bookNight = (date: string) => call(book, "/api/mock/bookings", { method: "POST", cookie: who.cookie,
      body: { requestId: who.requestId, serviceDate: date, party: "1-4", zoneId: "zone-indoor" } });
    const early = await bookNight("2026-11-12");
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("NIGHT_NOT_OPEN");
    vi.setSystemTime(new Date("2026-11-11T13:30:00Z")); // 20:30 Bangkok
    expect((await nightInfo("2026-11-12")).open).toBe(true);
    expect((await bookNight("2026-11-12")).status).toBe(201);
  });

  it("a later opening time delays the queue and shows a countdown", async () => {
    await putStandard(await owner(), { daysBefore: 0, time: "23:00" }); // tonight opens at 23:00 today
    const v = await venueNow();
    expect(v).toMatchObject({ open: false, secondsUntilOpen: 11 * 3600, opensAt: "2026-11-11T16:00:00.000Z" });
    const res = await call(joinQueue, "/api/mock/queue", { method: "POST", body: customer, cookie: await login() });
    expect(res.status).toBe(403);
    vi.setSystemTime(new Date("2026-11-11T16:00:01Z"));
    expect((await venueNow()).open).toBe(true);
  });

  it("special days override the standard rule, and can be deleted", async () => {
    const cookie = await owner();
    const made = await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-24", time: "20:00" });
    expect(made.status).toBe(201);
    const id = (await made.json()).special.id;
    await addSpecial(cookie, { serviceDate: "2026-11-11", opensOn: "2026-11-11", time: "18:00" }); // tonight opens at 18:00 today
    const listed = await (await call(hoursGet, "/api/mock/admin/hours", { cookie })).json();
    expect(listed.specials.map((s: { serviceDate: string }) => s.serviceDate)).toEqual(["2026-11-11", "2026-12-25"]);
    expect(listed.specials[0].opensAt).toBe("2026-11-11T11:00:00.000Z");
    expect(await nightInfo("2026-11-11")).toMatchObject({ open: false });
    expect((await venueNow()).open).toBe(false); // earliest opening is now 18:00 today
    vi.setSystemTime(new Date("2026-11-11T11:00:01Z"));
    expect(await nightInfo("2026-11-11")).toMatchObject({ open: true });
    expect((await call(specialDelete, `/api/mock/admin/hours/special/${id}`, { method: "DELETE", cookie }, { id })).status).toBe(200);
    expect((await call(specialDelete, `/api/mock/admin/hours/special/${id}`, { method: "DELETE", cookie }, { id })).status).toBe(404);
    expect((await call(specialDelete, `/api/mock/admin/hours/special/x`, { method: "DELETE", cookie: await staffOnly() }, { id: "x" })).status).toBe(403);
  });

  it("validates special days", async () => {
    const cookie = await owner();
    expect((await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-26", time: "20:00" })).status).toBe(400); // opens after the night
    expect((await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-24", time: "8pm" })).status).toBe(400);
    expect((await addSpecial(cookie, { serviceDate: "2026-11-10", opensOn: "2026-11-09", time: "20:00" })).status).toBe(422); // past night
    expect((await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-24", time: "20:00" })).status).toBe(201);
    const dup = await addSpecial(cookie, { serviceDate: "2026-12-25", opensOn: "2026-12-20", time: "10:00" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("SPECIAL_DAY_EXISTS");
  });
});


describe("mock admin shop settings and team", () => {
  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST" }); });
  const as = async (email: string) =>
    cookieOf(await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email } }));
  const owner = () => as("owner@bookie.test");
  const staffOnly = () => as("staff@bookie.test");
  const save = (cookie: string | undefined, body: object) =>
    call(settingsPut, "/api/mock/admin/settings", { method: "PUT", cookie, body });
  const invite = (cookie: string | undefined, body: object) =>
    call(inviteCreate, "/api/mock/admin/team/invites", { method: "POST", cookie, body });
  const profile = { name: "ร้านใหม่", phone: "081 234 5678", address: "กรุงเทพ", entryPolicy: "มาก่อนเวลา 15 นาที" };

  it("returns the default profile; only the owner can save it", async () => {
    const asOwner = await (await call(settingsGet, "/api/mock/admin/settings", { cookie: await owner() })).json();
    expect(asOwner).toEqual({
      profile: { name: "ร้านตัวอย่าง", phone: "02 123 4567", address: "เชียงใหม่ ประเทศไทย", entryPolicy: "กรุณามาถึงตามเวลาที่ร้านกำหนด" },
      canEdit: true,
    });
    expect((await (await call(settingsGet, "/api/mock/admin/settings", { cookie: await staffOnly() })).json()).canEdit).toBe(false);
    expect((await call(settingsGet, "/api/mock/admin/settings")).status).toBe(401);
    expect((await save(await staffOnly(), profile)).status).toBe(403);
    expect((await save(undefined, profile)).status).toBe(401);
  });

  it("saves the profile, validates it and shows it to customers", async () => {
    const cookie = await owner();
    expect((await save(cookie, profile)).status).toBe(200);
    expect((await (await call(settingsGet, "/api/mock/admin/settings", { cookie })).json()).profile).toEqual(profile);
    expect((await (await call(venue, "/api/mock/venue")).json()).shop).toEqual(profile);
    for (const bad of [{ ...profile, name: " " }, { ...profile, phone: "abc" }, { ...profile, address: "x".repeat(201) },
      { ...profile, extra: 1 }, { name: "A" }]) {
      expect((await save(cookie, bad)).status).toBe(400);
    }
    expect((await save(cookie, { ...profile, phone: "", address: "", entryPolicy: "" })).status).toBe(200); // optional fields can be cleared
  });

  it("lists the team and invitations", async () => {
    const data = await (await call(teamGet, "/api/mock/admin/team", { cookie: await staffOnly() })).json();
    expect(data.members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`)).toEqual(
      ["owner@bookie.test:owner", "staff@bookie.test:staff"]);
    expect(data).toMatchObject({ invites: [], canEdit: false });
    expect((await call(teamGet, "/api/mock/admin/team")).status).toBe(401);
  });

  it("invites staff by email, rejects duplicates and lets the owner cancel", async () => {
    const cookie = await owner();
    const made = await invite(cookie, { email: " New.Staff@Example.com ", role: "staff" });
    expect(made.status).toBe(201);
    const created = (await made.json()).invite;
    expect(created).toMatchObject({ email: "new.staff@example.com", role: "staff" });
    expect((await (await call(teamGet, "/api/mock/admin/team", { cookie })).json()).invites).toHaveLength(1);
    const dup = await invite(cookie, { email: "new.staff@example.com", role: "staff" });
    expect((await dup.json()).error.code).toBe("INVITE_EXISTS");
    expect((await (await invite(cookie, { email: "staff@bookie.test", role: "staff" })).json()).error.code).toBe("ALREADY_MEMBER");
    for (const bad of [{ email: "nope", role: "staff" }, { email: "a@b.co", role: "owner" }, { email: "a@b.co" }]) {
      expect((await invite(cookie, bad)).status).toBe(400);
    }
    const del = (id: string, c: string) => call(inviteDelete, `/api/mock/admin/team/invites/${id}`, { method: "DELETE", cookie: c }, { id });
    expect((await del(created.id, await staffOnly())).status).toBe(403);
    expect((await del(created.id, cookie)).status).toBe(200);
    expect((await del(created.id, cookie)).status).toBe(404);
    expect((await invite(await staffOnly(), { email: "x@y.co", role: "staff" })).status).toBe(403);
  });
});
