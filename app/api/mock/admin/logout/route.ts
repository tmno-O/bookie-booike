import { json, route } from "@/lib/http";
import { assertMockEnabled } from "@/mock/session";
import { clearStaffCookie } from "@/mock/staff";

export const POST = route<Record<string, string>>(async () => {
  assertMockEnabled();
  return json({ ok: true }, { headers: { "Set-Cookie": clearStaffCookie } });
});
