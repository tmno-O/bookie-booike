import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";

const config = vi.hoisted(() => ({ DIRECT_BOOKING_ENABLED: false }));
const session = vi.hoisted(() => vi.fn(async () => { throw new Error("session lookup reached"); }));
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", async (original) => ({ ...await original<typeof import("@/lib/env")>(), env: () => config }));
vi.mock("@/lib/auth/customer-session", () => ({ customerSession: session }));
vi.mock("@/server/services/booking-request", () => ({ createBookingRequest: create }));
afterEach(() => { config.DIRECT_BOOKING_ENABLED = false; vi.clearAllMocks(); });

const post = async (body: object) => {
  const { POST } = await import("../../app/api/booking-requests/route");
  return POST(new Request("http://localhost/api/booking-requests", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
};
const direct = { venueId: randomUUID(), serviceDate: "2026-12-01", tableId: randomUUID(), partySize: 4 };

it("rejects a customer table booking without a queue ticket before any session or queue work", async () => {
  const response = await post(direct);
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("QUEUE_TICKET_REQUIRED");
  expect(session).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("still accepts ticket payloads, and the direct path only when explicitly enabled", async () => {
  const ticket = { venueId: randomUUID(), ticketId: randomUUID(), zoneId: randomUUID(), serviceDate: "2026-12-01", partyBucket: "1-4" };
  await post(ticket);
  expect(session).toHaveBeenCalledTimes(1);
  config.DIRECT_BOOKING_ENABLED = true;
  await post(direct);
  expect(session).toHaveBeenCalledTimes(2);
});

it("refuses to start production with direct booking enabled", () => {
  const base = {
    NODE_ENV: "production", DATABASE_URL: "postgres://u:p@localhost/db", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "key", LINE_SECRET_KEY: "ab".repeat(32),
  };
  expect(parseEnv(base).DIRECT_BOOKING_ENABLED).toBe(false);
  expect(() => parseEnv({ ...base, DIRECT_BOOKING_ENABLED: "true" })).toThrow("DIRECT_BOOKING_ENABLED");
});
