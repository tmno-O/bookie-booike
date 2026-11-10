import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const user = await withDb((db) => requireUser(db, request));
  return json({ user: { userId: user.userId, displayName: user.displayName } });
});
