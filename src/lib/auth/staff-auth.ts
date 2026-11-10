import { createClient } from "@supabase/supabase-js";
import { db } from "../db";
import { env } from "../env";
import { ApiError, notFound } from "../errors";

export type Staff = { userId: string; venueId: string; role: "owner" | "staff" };

export async function staffSession(request: Request, venueId: string): Promise<Staff> {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new ApiError(401, "STAFF_SESSION_REQUIRED", "Supabase access token required");

  const config = env();
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000), cache: "no-store" }) },
  });
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error && (!error.status || error.status >= 500 || error.status === 429)) {
    throw new ApiError(503, "STAFF_AUTH_UNAVAILABLE", "Staff authentication is temporarily unavailable");
  }
  if (error || !data.user) throw new ApiError(401, "INVALID_STAFF_TOKEN", "Invalid Supabase access token");
  const [member] = await db()<Staff[]>`
    select user_id, venue_id, role from venue_members where venue_id = ${venueId} and user_id = ${data.user.id}
  `;
  if (!member) notFound("Venue");
  return member;
}
