import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PATCH as patchSettings } from "../../app/api/staff/venues/[venueId]/settings/route";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { customerAnnouncements, fanoutAnnouncement } from "@/server/services/announcements";
import { addSpecialHours, deleteSpecialHours, saveServiceHours } from "@/server/services/booking-hours";
import { deliverNextAnnouncement } from "../../worker/announcements";
import { deliverNextNotification } from "../../worker/notifications";

let fixture: Awaited<ReturnType<typeof setup>>;

beforeAll(() => {
  if (new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1") throw new Error("Local database required");
});
beforeEach(async () => { fixture = await setup(); });
afterEach(async () => { if (fixture) await cleanup(fixture); });
afterAll(() => db().end({ timeout: 5 }));

async function setup() {
  return db().begin(async (tx) => {
    const venueId = randomUUID(), userId = randomUUID(), zone = randomUUID(), table = randomUUID();
    const owner = { venueId, userId, role: "owner" as const };
    const [calendar] = await tx<{ today: string; bookingNight: string; specialNight: string }[]>`
      select today::text, (today + 5)::text as booking_night, (today + 7)::text as special_night
      from (select (now() at time zone 'Asia/Bangkok')::date as today) d
    `;
    await tx`insert into venues (id, slug, name) values (${venueId}, ${venueId}, 'Notification test')`;
    await tx`insert into auth.users (id) values (${userId})`;
    await tx`insert into venue_members (venue_id, user_id, role) values (${venueId}, ${userId}, 'owner')`;
    const staffToken = randomBytes(32).toString("base64url");
    await tx`insert into staff_sessions (token_hash, venue_id, user_id, expires_at)
      values (${sha256(staffToken)}, ${venueId}, ${userId}, now() + interval '1 hour')`;
    await tx`insert into zones (id, venue_id, name, capacity) values (${zone}, ${venueId}, 'Zone', 12)`;
    await tx`insert into venue_tables (id, venue_id, zone_id, name, capacity) values (${table}, ${venueId}, ${zone}, 'T1', 12)`;
    await tx`insert into venue_line_integrations (venue_id, provider_id, channel_id, liff_id, access_token_ciphertext)
      values (${venueId}, ${venueId}, 'local-test', 'local-test', ${encryptSecret("mock-token", `${venueId}:access-token`)})`;
    const customers = { booker: randomUUID(), newcomer: randomUUID() };
    for (const [subject, customerId] of Object.entries(customers)) {
      await tx`insert into customers (id) values (${customerId})`;
      await tx`insert into venue_customers (venue_id, customer_id, display_name) values (${venueId}, ${customerId}, ${subject})`;
      await tx`insert into customer_identities (provider_id, subject, customer_id) values (${venueId}, ${subject}, ${customerId})`;
    }
    return { owner, staffToken, table, customers, ...calendar };
  });
}

async function cleanup({ owner: { venueId, userId }, customers }: typeof fixture) {
  await db().begin(async (tx) => {
    await tx`delete from announcement_reminder_outbox where venue_id = ${venueId}`;
    await tx`delete from announcement_outbox where venue_id = ${venueId}`;
    await tx`delete from release_announcements where venue_id = ${venueId}`;
    await tx`delete from notification_outbox where venue_id = ${venueId}`;
    await tx`delete from booking_events where venue_id = ${venueId}`;
    await tx`delete from booking_allocations where venue_id = ${venueId}`;
    await tx`update booking_requests set status = 'queued', booking_id = null where venue_id = ${venueId} and booking_id is not null`;
    await tx`delete from bookings where venue_id = ${venueId}`;
    await tx`delete from booking_requests where venue_id = ${venueId}`;
    await tx`alter table audit_logs disable trigger audit_logs_immutable`;
    await tx`delete from audit_logs where venue_id = ${venueId}`;
    await tx`alter table audit_logs enable trigger audit_logs_immutable`;
    await tx`delete from booking_rules where venue_id = ${venueId}`;
    await tx`delete from booking_releases where venue_id = ${venueId}`;
    await tx`delete from venue_tables where venue_id = ${venueId}`;
    await tx`delete from zones where venue_id = ${venueId}`;
    await tx`delete from venue_line_integrations where venue_id = ${venueId}`;
    await tx`delete from customer_identities where provider_id = ${venueId}`;
    await tx`delete from venue_customers where venue_id = ${venueId}`;
    await tx`delete from customers where id in ${tx(Object.values(customers))}`;
    await tx`delete from auth.users where id = ${userId}`;
    await tx`delete from venues where id = ${venueId}`;
  });
}

async function book(customerId: string, serviceDate = fixture.bookingNight) {
  const { owner: { venueId }, table } = fixture;
  const [request] = await db()<{ id: string }[]>`insert into booking_requests
    (venue_id, customer_id, actor_type, actor_id, source, service_date, party_size, table_id, idempotency_key, payload_hash, status)
    values (${venueId}, ${customerId}, 'customer', ${customerId}, 'liff', ${serviceDate}, 2, ${table}, ${randomUUID()}, 'line-test', 'queued')
    returning id`;
  return decide(request.id);
}

async function decide(requestId: string) {
  const [result] = await db()<{
    id: string; bookingId: string | null; status: string; resultCode: string | null;
  }[]>`select * from process_booking_request(${requestId})`;
  return result;
}

async function addSpecial() {
  const { owner, today, specialNight } = fixture;
  await addSpecialHours(owner, { serviceDate: specialNight, opensOn: today, time: "00:00", title: "Festival", announce: true });
  const [announcement] = await db()<{ id: string }[]>`select id from release_announcements where venue_id = ${owner.venueId}`;
  return announcement.id;
}

function mockLine() {
  return vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 200 }));
}

async function saveReminders(patch: { bookingReminderHours?: number | null; specialReminderHours?: number | null }) {
  const { owner: { venueId }, staffToken } = fixture;
  const request = new Request(`http://localhost/api/staff/venues/${venueId}/settings`, {
    method: "PATCH", body: JSON.stringify(patch), headers: {
      "Content-Type": "application/json", Origin: "http://localhost", Cookie: `bookie_staff_session=${staffToken}`,
    },
  });
  const response = await patchSettings(request, { params: Promise.resolve({ venueId }) });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject(patch);
}

function messageAt(send: ReturnType<typeof mockLine>, index: number) {
  const [url, init] = send.mock.calls[index];
  const { to, messages } = JSON.parse(String(init?.body));
  return { url, to, title: messages[0].altText, contents: messages[0].contents.body.contents,
    retryKey: new Headers(init?.headers).get("X-Line-Retry-Key") };
}

it("delivers confirmed and rejected results once to the right customers and holds the booking reminder until due", async () => {
  const { owner: { venueId }, customers } = fixture;
  const winner = await book(customers.booker);
  const rejected = await book(customers.newcomer);
  expect(winner.status).toBe("confirmed");
  expect(rejected).toMatchObject({ status: "rejected", resultCode: "TABLE_UNAVAILABLE", bookingId: null });
  await decide(winner.id);
  await decide(rejected.id);

  const send = mockLine();
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  expect(await deliverNextNotification(send, venueId)).toBe(false);
  expect(messageAt(send, 0)).toMatchObject({ to: "booker", title: "ยืนยันการจองแล้ว" });
  expect(messageAt(send, 1)).toMatchObject({ to: "newcomer", title: "จองไม่สำเร็จ" });
  expect(messageAt(send, 1).contents).toContainEqual(expect.objectContaining({ text: "โต๊ะที่เลือกไม่ว่าง" }));

  const [job] = await db()`select n.id, n.status, n.next_attempt_at = b.service_at - interval '24 hours' as correct
    from notification_outbox n join bookings b on b.id = n.booking_id where n.booking_id = ${winner.bookingId} and n.kind = 'reminder'`;
  expect(job).toMatchObject({ status: "scheduled", correct: true });
  const makeDue = () => db()`update notification_outbox set next_attempt_at = now() where id = ${job.id}`;
  await makeDue();
  send.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  expect(await deliverNextNotification(send, venueId)).toBe(false);
  await makeDue();
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  expect(await deliverNextNotification(send, venueId)).toBe(false);
  expect(messageAt(send, 2)).toMatchObject({ to: "booker", title: "เตือนก่อนถึงวันจอง", retryKey: job.id });
  expect(messageAt(send, 3).retryKey).toBe(job.id);
});

it("skips reminders for bookings cancelled before delivery", async () => {
  const { owner: { venueId }, customers: { booker } } = fixture;
  const { bookingId } = await book(booker);
  const send = mockLine();
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  const [cancelled] = await db()`select cancel_booking(${venueId}, ${bookingId}, 'customer', ${booker}) as code`;
  expect(cancelled.code).toBe("CANCELLED");
  await db()`update notification_outbox set next_attempt_at = now() where booking_id = ${bookingId} and kind = 'reminder'`;
  while (await deliverNextNotification(send, venueId)) { /* drain the fixture */ }
  expect(send).toHaveBeenCalledTimes(2);
  expect(messageAt(send, 1)).toMatchObject({ to: "booker", title: "ยกเลิกการจองแล้ว" });
  const [job] = await db()`select status, last_error from notification_outbox where booking_id = ${bookingId} and kind = 'reminder'`;
  expect(job).toMatchObject({ status: "skipped", lastError: "BOOKING_NOT_CONFIRMED" });
});

it("shows one in-app announcement and sends a separate special-day reminder only to past bookers", async () => {
  const { owner: { venueId }, customers } = fixture;
  expect((await book(customers.booker)).status).toBe("confirmed");
  const id = await addSpecial();
  await fanoutAnnouncement(id);
  const [job] = await db()`select o.id, o.customer_id,
      o.next_attempt_at = ((a.service_date - 1) + time '11:00') at time zone 'UTC' as correct
    from announcement_reminder_outbox o join release_announcements a on a.id = o.announcement_id where a.id = ${id}`;
  expect(job).toMatchObject({ customerId: customers.booker, correct: true });
  const send = mockLine();
  expect(await deliverNextAnnouncement(send, venueId)).toBe(true);
  expect(messageAt(send, 0)).toMatchObject({ to: ["booker"], title: "รอบใหม่: Festival" });
  expect(await deliverNextAnnouncement(send, venueId)).toBe(false);
  await db()`update announcement_reminder_outbox set next_attempt_at = now(), created_at = now() - interval '3 days' where id = ${job.id}`;
  expect(await deliverNextAnnouncement(send, venueId)).toBe(true);
  expect(messageAt(send, 1)).toMatchObject({ to: ["booker"], title: "เตือนวันพิเศษ: Festival" });
  expect(await deliverNextAnnouncement(send, venueId)).toBe(false);
  const list = await customerAnnouncements({ venueId, customerId: customers.booker, tokenHash: "scenario" });
  expect(list.announcements).toHaveLength(1);
});

it("skips a special-day reminder if the release was removed", async () => {
  const { owner, specialNight, customers } = fixture;
  await book(customers.booker);
  const id = await addSpecial();
  await deleteSpecialHours(owner, specialNight);
  await db()`update announcement_reminder_outbox set next_attempt_at = now() where announcement_id = ${id}`;
  const send = mockLine();
  expect(await deliverNextAnnouncement(send, owner.venueId)).toBe(true);
  const [job] = await db()`select status, last_error from announcement_reminder_outbox where announcement_id = ${id}`;
  expect(job).toMatchObject({ status: "skipped", lastError: "RELEASE_UNAVAILABLE" });
  expect(send).not.toHaveBeenCalled();
});

it("reschedules upcoming reminders independently, lets owners turn them off, and keeps final booking messages", async () => {
  const { owner: { venueId }, customers, specialNight } = fixture;
  const booking = await book(customers.booker);
  const announcementId = await addSpecial();
  const bookingJobs = () => db()`select n.id, n.status,
      extract(epoch from (b.service_at - n.next_attempt_at))::int / 3600 as hours_before
    from notification_outbox n join bookings b on b.id = n.booking_id
    where n.venue_id = ${venueId} and n.kind = 'reminder'`;
  const specialJobs = () => db()`select id, status, next_attempt_at
    from announcement_reminder_outbox where announcement_id = ${announcementId}`;

  await saveReminders({ bookingReminderHours: 2, specialReminderHours: 6 });
  expect(await bookingJobs()).toMatchObject([{ status: "scheduled", hoursBefore: 2 }]);
  expect(await specialJobs()).toMatchObject([{ status: "pending", nextAttemptAt: new Date(`${specialNight}T12:00:00+07:00`) }]);

  await saveReminders({ bookingReminderHours: null });
  expect(await bookingJobs()).toHaveLength(0);
  expect(await specialJobs()).toHaveLength(1);
  expect((await book(customers.newcomer, specialNight)).status).toBe("confirmed");
  expect(await bookingJobs()).toHaveLength(0);

  await saveReminders({ specialReminderHours: null });
  expect(await specialJobs()).toHaveLength(0);
  const send = mockLine();
  while (await deliverNextNotification(send, venueId)) { /* drain final booking messages */ }
  expect(send).toHaveBeenCalledTimes(2);
  expect(messageAt(send, 0)).toMatchObject({ title: "ยืนยันการจองแล้ว" });
  expect(await deliverNextAnnouncement(send, venueId)).toBe(true);
  expect(messageAt(send, 2)).toMatchObject({ title: "รอบใหม่: Festival" });

  await saveReminders({ bookingReminderHours: 4, specialReminderHours: 4 });
  expect(await bookingJobs()).toMatchObject([{ hoursBefore: 4 }, { hoursBefore: 4 }]);
  expect(await specialJobs()).toMatchObject([{ nextAttemptAt: new Date(`${specialNight}T14:00:00+07:00`) }]);
  await db()`update notification_outbox set next_attempt_at = now() where booking_id = ${booking.bookingId} and kind = 'reminder'`;
  expect(await deliverNextNotification(send, venueId)).toBe(true);
  const sent = (await bookingJobs()).find(({ status }) => status === "sent");
  expect(sent).toBeDefined();
  await saveReminders({ bookingReminderHours: 1 });
  expect(await bookingJobs()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: sent?.id, status: "sent" }), expect.objectContaining({ status: "scheduled", hoursBefore: 1 }),
  ]));
});

it("anchors special-day reminders to the venue's current opening time", async () => {
  const { owner, customers, specialNight } = fixture;
  await book(customers.booker);
  const announcementId = await addSpecial();
  await saveReminders({ specialReminderHours: 3 });
  await saveServiceHours(owner, { openWeekdays: [0, 1, 2, 3, 4, 5, 6], serviceStart: "20:30", serviceEnd: "02:00" });
  const [job] = await db()`select reminder_at, next_attempt_at from announcement_reminder_outbox where announcement_id = ${announcementId}`;
  const expected = new Date(`${specialNight}T17:30:00+07:00`);
  expect(job).toMatchObject({ reminderAt: expected, nextAttemptAt: expected });
});
