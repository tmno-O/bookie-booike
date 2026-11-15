import { afterEach, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ LINE_VERIFY_MODE: "real" }));
const venueRow = vi.hoisted(() => ({ id: "v1", providerId: "provider", channelId: "2012596651", liffId: "2012596651-G0OsQbQh" }));
vi.mock("@/lib/env", () => ({ env: () => config }));
vi.mock("@/lib/db", () => ({ db: () => async () => [venueRow] }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); venueRow.channelId = "2012596651"; });

const lineReplies = (status: number, body: object) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return fetch;
};

it("reads the owning LINE Login channel from a LIFF ID", async () => {
  const { liffChannel } = await import("@/lib/auth/line-verify");
  expect(liffChannel("2012596651-G0OsQbQh")).toBe("2012596651");
  expect(liffChannel("not-a-liff-id")).toBeNull();
});

it("maps LINE's verify errors to expired, channel mismatch, or invalid", async () => {
  const { verifyLineToken } = await import("@/lib/auth/line-verify");
  const cases = [
    ["IdToken expired.", "LINE_TOKEN_EXPIRED"],
    ["Invalid IdToken audience.", "LINE_CHANNEL_MISMATCH"],
    ["Invalid IdToken.", "INVALID_LINE_TOKEN"],
  ] as const;
  for (const [description, code] of cases) {
    lineReplies(400, { error: "invalid_request", error_description: description });
    await expect(verifyLineToken("token", "2012596651")).rejects.toMatchObject({ status: 401, code });
  }
  const fetch = lineReplies(200, { sub: "U1", name: "Guest" });
  await expect(verifyLineToken("token", "2012596651")).resolves.toEqual({ sub: "U1", name: "Guest" });
  expect(String(fetch.mock.calls[0][1]?.body)).toContain("client_id=2012596651");
});

it("refuses login before calling LINE when the configured channel does not own the LIFF app", async () => {
  const { startCustomerSession } = await import("@/lib/auth/customer-session");
  const fetch = lineReplies(200, { sub: "U1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  venueRow.channelId = "1234567890";
  await expect(startCustomerSession(new Request("http://localhost/api/session/line"), "bookie-demo", "token"))
    .rejects.toMatchObject({ status: 409, code: "LINE_CHANNEL_MISMATCH" });
  expect(fetch).not.toHaveBeenCalled();
});
