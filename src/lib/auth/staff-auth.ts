import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { ISql } from "postgres";
import type { z } from "zod";
import type { staffLoginInput } from "@/contracts/staff";
import { sha256 } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { ApiError, notFound } from "../errors";

export type Staff = { userId: string; venueId: string; role: "owner" | "staff" };

const cookieName = "bookie_staff_session";
const sessionSeconds = 8 * 60 * 60;

function supabaseAuth() {
  const config = env();
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5_000), cache: "no-store" }) },
  }).auth;
}

function cookieHash(request: Request) {
  const cookies = request instanceof NextRequest ? request.cookies : new NextRequest(request.url, { headers: request.headers }).cookies;
  const token = cookies.get(cookieName)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
}

function withCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set(cookieName, token, {
    httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/", maxAge,
  });
  return response;
}

async function findMembership(sql: ISql, userId: string, venue: { id?: string; slug?: string } = {}) {
  const matches = await sql<Staff[]>`
    select m.user_id, m.venue_id, m.role from venue_members m join venues v on v.id = m.venue_id
    where m.user_id = ${userId}
    ${venue.id ? sql`and v.id = ${venue.id}` : sql``}
    ${venue.slug ? sql`and v.slug = ${venue.slug}` : sql``}
    order by m.venue_id limit 2 for key share of m
  `;
  if (!matches.length) notFound("Venue");
  if (matches.length > 1) throw new ApiError(409, "VENUE_REQUIRED", "ระบุรหัสร้านเพื่อเข้าสู่ระบบ");
  return matches[0];
}

export async function staffSession(request: Request, venueId?: string): Promise<Staff> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer (\S+)$/i.exec(authorization);
    if (!match) throw new ApiError(401, "INVALID_STAFF_TOKEN", "Invalid Supabase access token");
    const { data, error } = await supabaseAuth().getUser(match[1]);
    if (error && (!error.status || error.status >= 500 || error.status === 429)) {
      throw new ApiError(503, "STAFF_AUTH_UNAVAILABLE", "Staff authentication is temporarily unavailable");
    }
    if (error || !data.user) throw new ApiError(401, "INVALID_STAFF_TOKEN", "Invalid Supabase access token");
    return findMembership(db(), data.user.id, { id: venueId });
  }

  const hash = cookieHash(request);
  if (!hash) throw new ApiError(401, "STAFF_SESSION_REQUIRED", "กรุณาเข้าสู่ระบบร้านค้า");
  const [member] = await db()<Staff[]>`
    select m.user_id, m.venue_id, m.role from staff_sessions s
    join venue_members m using (venue_id, user_id)
    join auth.users u on u.id = m.user_id
    where s.token_hash = ${hash} and s.expires_at > now()
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  `;
  if (!member) throw new ApiError(401, "STAFF_SESSION_REQUIRED", "กรุณาเข้าสู่ระบบร้านค้า");
  if (venueId && member.venueId !== venueId) notFound("Venue");
  return member;
}

export async function readStaffProfile(staff: Staff) {
  const [profile] = await db()<{
    email: string; displayName: string; id: string; slug: string; name: string;
  }[]>`
    select u.email, coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)) as display_name,
      v.id, v.slug, v.name
    from auth.users u cross join venues v where u.id = ${staff.userId} and v.id = ${staff.venueId}
  `;
  if (!profile) notFound("Staff profile");
  const { email, displayName, id, slug, name } = profile;
  return { staff: { email, displayName, role: staff.role }, venue: { id, slug, name } };
}

export async function startStaffSession(request: Request, credentials: z.infer<typeof staffLoginInput>) {
  const { email, password, venueSlug } = credentials;
  const { data, error } = await supabaseAuth().signInWithPassword({ email, password });
  if (error?.status === 429) throw new ApiError(429, "RATE_LIMITED", "ลองเข้าสู่ระบบใหม่ภายหลัง");
  if (error && (!error.status || error.status >= 500)) {
    throw new ApiError(503, "STAFF_AUTH_UNAVAILABLE", "ระบบเข้าสู่ระบบไม่พร้อมใช้งาน");
  }
  if (!data.user || error) throw new ApiError(401, "INVALID_STAFF_CREDENTIALS", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");

  const userId = data.user.id;
  const token = randomBytes(32).toString("base64url");
  const previous = cookieHash(request);
  const staff = await db().begin(async (tx) => {
    const member = await findMembership(tx, userId, { slug: venueSlug });
    if (previous) await tx`delete from staff_sessions where token_hash = ${previous}`;
    await tx`
      insert into staff_sessions (token_hash, venue_id, user_id, expires_at)
      values (${sha256(token)}, ${member.venueId}, ${userId}, now() + ${sessionSeconds} * interval '1 second')
    `;
    return member;
  });
  const profile = await readStaffProfile(staff);
  return withCookie(NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } }), token, sessionSeconds);
}

export async function endStaffSession(request: Request) {
  const hash = cookieHash(request);
  if (hash) await db()`delete from staff_sessions where token_hash = ${hash}`;
  return withCookie(new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } }), "", 0);
}
