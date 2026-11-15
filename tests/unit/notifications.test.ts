import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { sendLinePush } from "@/server/line-push";
import { POST as drain } from "../../app/api/internal/notifications/drain/route";

const config = vi.hoisted(() => ({ CRON_SECRET: "x".repeat(32), LINE_SECRET_KEY: "ab".repeat(32), LINE_NOTIFICATIONS_ENABLED: true, LINE_VERIFY_MODE: "real" }));
const runDrain = vi.hoisted(() => vi.fn(async () => ({ bookings: 1, announcements: 2 })));
vi.mock("@/lib/env", () => ({ env: () => config }));
vi.mock("@/server/services/notification-drain", () => ({ drainNotifications: runDrain }));
afterEach(() => { config.CRON_SECRET = "x".repeat(32); config.LINE_NOTIFICATIONS_ENABLED = true; vi.clearAllMocks(); });

it("rejects missing cron configuration and invalid credentials before draining", async () => {
  const call = (authorization?: string) => drain(new Request("http://localhost/api/internal/notifications/drain", {
    method: "POST", headers: authorization ? { authorization } : {},
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
