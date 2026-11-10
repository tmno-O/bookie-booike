import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { assertMockEnabled } from "@/mock/session";
import { MOCK_STAFF, staffCookie } from "@/mock/staff";

// Mock of the Supabase staff sign-in: pick an account, receive a session cookie.
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const { email } = await body(request, z.strictObject({ email: z.string().max(200) }));
  const staff = MOCK_STAFF.find((s) => s.email === email);
  if (!staff) throw new ApiError(401, "INVALID_CREDENTIALS", "Unknown staff account");
  return json({ staff }, { headers: { "Set-Cookie": staffCookie(staff.email) } });
});
