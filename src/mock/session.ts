import { ApiError } from "@/lib/errors";
import type { Db, LineUser } from "./db";

const COOKIE = "mock_customer";

/** Mock APIs are for local testing only. */
export function assertMockEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.MOCK_API !== "1") {
    throw new ApiError(404, "NOT_FOUND", "Not found");
  }
}

export function customerId(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`));
  return match?.[1] ?? null;
}

export function customerCookie(id: string) {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export const clearCustomerCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The logged-in LINE user for this request, or a 401. */
export function requireUser(db: Db, request: Request): LineUser {
  const id = customerId(request);
  const user = id && db.lineUsers.find((u) => u.id === id);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Log in with LINE first");
  return user;
}
