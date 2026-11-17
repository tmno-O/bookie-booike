import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { checkMessagingToken, sendLineMulticast, sendLinePush } from "@/server/line-push";
import { bookingNoticeMessage, releaseNoticeMessage } from "@/server/notification-message";
import { bookingAfterLogin, safeBookingLoginQuery } from "@/lib/booking-links";
import { scheduleBookingConfirmation } from "@/server/services/notification-drain";
import { GET, POST } from "../../app/api/internal/notifications/drain/route";

const config = vi.hoisted(() => ({ CRON_SECRET: "x".repeat(32), LINE_SECRET_KEY: "ab".repeat(32), LINE_NOTIFICATIONS_ENABLED: true, LINE_VERIFY_MODE: "real" }));
const runDrain = vi.hoisted(() => vi.fn(async () => ({ bookings: 1, announcements: 2 })));
const afterResponse = vi.hoisted(() => vi.fn<(task: () => Promise<void>) => void>());
const deliver = vi.hoisted(() => vi.fn<(send?: typeof fetch, venueId?: string, bookingId?: string) => Promise<boolean>>().mockResolvedValue(false));
vi.mock("@/lib/env", () => ({ env: () => config }));
vi.mock("next/server", () => ({ after: afterResponse }));
vi.mock("../../worker/notifications", () => ({ deliverNextNotification: deliver }));
vi.mock("@/server/services/notification-drain", async (original) => ({
  ...await original<typeof import("@/server/services/notification-drain")>(), drainNotifications: runDrain,
}));
afterEach(() => { config.CRON_SECRET = "x".repeat(32); config.LINE_NOTIFICATIONS_ENABLED = true; vi.clearAllMocks(); });

it.each([["GET", GET], ["POST", POST]] as const)("authenticates %s before draining", async (method, drain) => {
  const call = (authorization?: string) => drain(new Request("http://localhost/api/internal/notifications/drain", {
    method, headers: authorization ? { authorization } : {},
  }), { params: Promise.resolve({}) });
  config.CRON_SECRET = "";
  expect((await call()).status).toBe(503);
  config.CRON_SECRET = "x".repeat(32);
  expect((await call()).status).toBe(401);
  expect((await call(`Bearer ${"y".repeat(32)}`)).status).toBe(401);
  expect(runDrain).not.toHaveBeenCalled();
  expect(await (await call(`Bearer ${config.CRON_SECRET}`)).json()).toEqual({ bookings: 1, announcements: 2 });
  config.LINE_NOTIFICATIONS_ENABLED = false;
  expect((await (await call(`Bearer ${config.CRON_SECRET}`)).json()).disabled).toBe(true);
  expect(runDrain).toHaveBeenCalledTimes(1);
});

it("schedules only this booking's confirmation after the response when LINE is enabled", async () => {
  const venueId = randomUUID(), bookingId = randomUUID();
  config.LINE_NOTIFICATIONS_ENABLED = false;
  scheduleBookingConfirmation(venueId, bookingId);
  expect(afterResponse).not.toHaveBeenCalled();

  config.LINE_NOTIFICATIONS_ENABLED = true;
  deliver.mockResolvedValueOnce(true);
  scheduleBookingConfirmation(venueId, bookingId);
  expect(deliver).not.toHaveBeenCalled();
  await afterResponse.mock.calls[0][0]();
  expect(deliver.mock.calls).toEqual([[undefined, venueId, bookingId], [undefined, venueId, bookingId]]);
});

it("builds a pending-booking message with the venue, reservation details and LIFF button", () => {
  const message = bookingNoticeMessage({ kind: "received", name: "ร้านตัวอย่าง", slug: "test-store", liffId: "123-abc",
    serviceDate: "2026-12-24", serviceTime: "20:30", zoneName: "VIP", partySize: 4, reference: "BL-2026-0001", resultCode: null, note: null });
  expect(message.altText).toBe("ได้รับคำขอ รอร้านยืนยัน");
  expect(message.contents.body.contents).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: "ร้านตัวอย่าง" }), expect.objectContaining({ text: expect.stringMatching(/24.*ธ\.ค\..*20:30/) }),
    expect.objectContaining({ text: "โซน VIP" }), expect.objectContaining({ text: "จำนวน 4 คน" }),
    expect.objectContaining({ text: "เลขอ้างอิง BL-2026-0001" }),
  ]));
  expect(message.contents.footer?.contents[0].action.uri).toBe("https://liff.line.me/123-abc/?next=bookings");
});

it("localizes special releases and preserves only known booking destinations", () => {
  const message = releaseNoticeMessage({ title: "Festival", name: "Bookie", slug: "test-store", liffId: null,
    serviceDate: "2026-12-24", opensAt: new Date("2026-12-23T18:30:00Z"), timezone: "Asia/Bangkok", reminder: false }, "https://bookie.example");
  expect(message.contents.body.contents).toContainEqual(expect.objectContaining({ text: expect.stringMatching(/^เปิดจอง 24.*01:30/) }));
  expect(message.contents.footer?.contents[0].action.uri).toBe("https://bookie.example/book/test-store/select?date=2026-12-24");
  expect(bookingAfterLogin("test-store", "?next=select&date=2026-12-24")).toBe("/book/test-store/select?date=2026-12-24");
  expect(bookingAfterLogin("test-store", "?next=https://example.com")).toBe("/book/test-store/details");
  expect(safeBookingLoginQuery("?next=select&date=2026-02-30&liff.state=private")).toBe("?next=select");
});

it("uses stable LINE retry IDs and distinguishes retry, duplicate acceptance, permanent failure, and stale jobs", async () => {
  const venueId = randomUUID();
  const job = { id: randomUUID(), venueId, subject: "Utest", accessTokenCiphertext: encryptSecret("token", `${venueId}:access-token`), stale: false };
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
  expect(await sendLinePush(job, [{ type: "text", text: "Round" }], send)).toMatchObject({ status: "retry", error: "LINE_HTTP_429" });
  expect(new Headers(send.mock.calls[0][1]?.headers).get("X-Line-Retry-Key")).toBe(job.id);
  send.mockResolvedValue(new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted" } }));
  expect((await sendLinePush(job, [], send)).status).toBe("sent");
  send.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await sendLinePush(job, [], send)).status).toBe("dead");
  send.mockRejectedValue(new Error("offline"));
  expect((await sendLinePush(job, [], send)).error).toBe("LINE_NETWORK_ERROR");
  send.mockClear();
  expect((await sendLinePush({ ...job, stale: true }, [], send)).status).toBe("dead");
  expect((await sendLinePush({ ...job, subject: null }, [], send)).status).toBe("skipped");
  expect(send).not.toHaveBeenCalled();
});

it("sends one multicast per batch with the batch id as retry key and caps recipients at 500", async () => {
  const venueId = randomUUID(), batchId = randomUUID();
  const sender = { retryKey: batchId, venueId, accessTokenCiphertext: encryptSecret("token", `${venueId}:access-token`) };
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  expect((await sendLineMulticast(sender, ["U1", "U2"], [{ type: "text", text: "Round" }], send)).status).toBe("sent");
  const [url, init] = send.mock.calls[0];
  expect(url).toBe("https://api.line.me/v2/bot/message/multicast");
  expect(new Headers(init?.headers).get("X-Line-Retry-Key")).toBe(batchId);
  expect(JSON.parse(String(init?.body)).to).toEqual(["U1", "U2"]);
  expect((await sendLineMulticast(sender, [], [], send)).status).toBe("skipped");
  expect(() => sendLineMulticast(sender, Array.from({ length: 501 }, (_, i) => `U${i}`), [], send)).toThrow();
  expect((await sendLineMulticast({ ...sender, accessTokenCiphertext: null }, ["U1"], [], send)).status).toBe("skipped");
});

describe("Messaging API token check", () => {
  const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("accepts a token LINE recognises and reports the bot name", async () => {
    expect(await checkMessagingToken("token", reply(200, { displayName: "Bookie" }))).toEqual({ status: "valid", botName: "Bookie" });
  });
  it("refuses a token LINE rejects and separates outages", async () => {
    expect(await checkMessagingToken("token", reply(401))).toEqual({ status: "invalid" });
    expect(await checkMessagingToken("token", reply(500))).toEqual({ status: "unavailable" });
    expect(await checkMessagingToken("token", (async () => { throw new Error("offline"); }) as unknown as typeof fetch))
      .toEqual({ status: "unavailable" });
  });
});
