import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "../db";
import { sha256 } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { verifyLineToken } from "./line-verify";

const cookieName = "bookie_session";
const sessionSeconds = 7 * 24 * 60 * 60;

export type Customer = { customerId: string; venueId: string; tokenHash: string };

function tokenHash(request: Request) {
  const token = new NextRequest(request).cookies.get(cookieName)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
}

function withCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set(cookieName, token, {
    httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/", maxAge,
  });
  return response;
}

export async function customerSession(request: Request, venueId?: string): Promise<Customer> {
  const hash = tokenHash(request);
  if (!hash) throw new ApiError(401, "SESSION_REQUIRED", "Customer session required");
  const [session] = await db()<Customer[]>`
    select venue_id, customer_id, token_hash from customer_sessions
    where token_hash = ${hash} and expires_at > now()
  `;
  if (!session) throw new ApiError(401, "SESSION_REQUIRED", "Customer session required");
  if (venueId && session.venueId !== venueId) notFound("Venue");
  return session;
}

export async function startCustomerSession(request: Request, venueSlug: string, idToken: string) {
  const [venue] = await db()<{
    id: string; providerId: string | null; channelId: string | null;
  }[]>`
    select v.id, l.provider_id, l.channel_id from venues v
    left join venue_line_integrations l on l.venue_id = v.id where v.slug = ${venueSlug}
  `;
  if (!venue) notFound("Venue");
  const { providerId, channelId } = venue;
  if (!providerId || !channelId) throw new ApiError(409, "LINE_NOT_CONFIGURED", "LINE is not configured");
  const profile = await verifyLineToken(idToken, channelId);
  const token = randomBytes(32).toString("base64url");
  const previousHash = tokenHash(request);
  const displayName = profile.name?.trim() || "LINE customer";

  const customerId = await db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([providerId, profile.sub])}, 1))`;
    const [integration] = await tx`
      select 1 from venue_line_integrations
      where venue_id = ${venue.id} and provider_id = ${providerId} and channel_id = ${channelId}
      for share
    `;
    if (!integration) throw new ApiError(409, "LINE_CONFIGURATION_CHANGED", "Retry with the current LIFF app");

    const [identity] = await tx<{ customerId: string }[]>`
      select customer_id from customer_identities where provider_id = ${providerId} and subject = ${profile.sub}
    `;
    let id = identity?.customerId;
    if (!id) {
      const [customer] = await tx<{ id: string }[]>`insert into customers default values returning id`;
      id = customer.id;
      await tx`insert into customer_identities values (${providerId}, ${profile.sub}, ${id})`;
    }
    await tx`
      insert into venue_customers (venue_id, customer_id, display_name)
      values (${venue.id}, ${id}, ${displayName})
      on conflict (venue_id, customer_id) do update set display_name = excluded.display_name
    `;
    if (previousHash) await tx`delete from customer_sessions where token_hash = ${previousHash}`;
    await tx`
      insert into customer_sessions (token_hash, venue_id, customer_id, expires_at)
      values (${sha256(token)}, ${venue.id}, ${id}, now() + ${sessionSeconds} * interval '1 second')
    `;
    return id;
  });

  return withCookie(NextResponse.json({ venueId: venue.id, customerId, displayName }, {
    headers: { "Cache-Control": "no-store" },
  }), token, sessionSeconds);
}

export async function endCustomerSession(request: Request) {
  const hash = tokenHash(request);
  if (hash) await db()`delete from customer_sessions where token_hash = ${hash}`;
  return withCookie(new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } }), "", 0);
}
