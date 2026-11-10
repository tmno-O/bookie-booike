import { json, route } from "@/lib/http";
import { assertMockEnabled } from "@/mock/session";
import { MOCK_STAFF } from "@/mock/staff";

export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  return json({ accounts: MOCK_STAFF });
});
