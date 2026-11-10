import { json, route } from "@/lib/http";
import { MOCK_LINE_ACCOUNTS } from "@/mock/line";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async () => {
  assertMockEnabled();
  return json({ accounts: MOCK_LINE_ACCOUNTS });
});
