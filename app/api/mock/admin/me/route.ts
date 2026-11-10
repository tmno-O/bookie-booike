import { json, route } from "@/lib/http";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  return json({ staff: requireStaff(request) });
});
