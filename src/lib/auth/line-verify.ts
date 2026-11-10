import { z } from "zod";
import { env } from "../env";
import { ApiError } from "../errors";

const claims = z.object({ sub: z.string().min(1).max(255), name: z.string().max(255).optional() });

export async function verifyLineToken(idToken: string, channelId: string) {
  if (env().LINE_VERIFY_MODE === "mock") {
    const match = /^mock:([A-Za-z0-9_-]{1,100})(?::(.{1,120}))?$/.exec(idToken);
    if (!match) throw new ApiError(401, "INVALID_LINE_TOKEN", "Invalid mock LINE token");
    return { sub: match[1], name: match[2] };
  }

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  }).catch(() => null);
  if (!response || response.status === 429 || response.status >= 500) {
    throw new ApiError(503, "LINE_UNAVAILABLE", "LINE verification is temporarily unavailable");
  }

  const result = claims.safeParse(response.ok ? await response.json().catch(() => null) : null);
  if (!result.success) throw new ApiError(401, "INVALID_LINE_TOKEN", "Invalid LINE token");
  return result.data;
}
