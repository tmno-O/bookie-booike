import { json, route } from "@/lib/http";
import { assertMockEnabled, clearCustomerCookie } from "@/mock/session";

export const POST = route<Record<string, string>>(async () => {
  assertMockEnabled();
  return json({ ok: true }, { headers: { "Set-Cookie": clearCustomerCookie } });
});
