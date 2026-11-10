import { ApiError } from "@/lib/errors";

// Mock staff accounts (same emails as the local Supabase demo users in README.md).
export const MOCK_STAFF = [
  { email: "owner@bookie.test", displayName: "เจ้าของร้าน", role: "owner" },
  { email: "staff@bookie.test", displayName: "พนักงาน", role: "staff" },
] as const;
export type MockStaff = (typeof MOCK_STAFF)[number];

const COOKIE = "mock_staff";

export function staffCookie(email: string) {
  return `${COOKIE}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}
export const clearStaffCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The logged-in mock staff member, or a 401. */
export function requireStaff(request: Request): MockStaff {
  const raw = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  const email = raw ? decodeURIComponent(raw) : null;
  const staff = MOCK_STAFF.find((s) => s.email === email);
  if (!staff) throw new ApiError(401, "UNAUTHENTICATED", "Staff login required");
  return staff;
}
