import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { MOCK_TOKEN } from "@/mock/line";
import { assertMockEnabled, customerCookie } from "@/mock/session";

// Mock of POST /api/session/line: exchanges a (mock) LINE ID token for a session cookie.
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const { idToken } = await body(request, z.strictObject({ idToken: z.string().min(1).max(500) }));
  const match = MOCK_TOKEN.exec(idToken);
  if (!match) throw new ApiError(401, "INVALID_LINE_TOKEN", "Invalid mock LINE token");
  const [, userId, displayName] = match;
  const user = await withDb((db) => {
    let found = db.lineUsers.find((u) => u.userId === userId);
    if (!found) {
      found = { id: `line-${userId}`, userId, displayName, createdAt: new Date().toISOString() };
      db.lineUsers.push(found);
    } else found.displayName = displayName;
    return found;
  });
  return json({ user: { userId: user.userId, displayName: user.displayName } },
    { headers: { "Set-Cookie": customerCookie(user.id) } });
});
