import { z } from "zod";
import { env } from "../env";
import { ApiError } from "../errors";

const claims = z.object({ sub: z.string().min(1).max(255), name: z.string().max(255).optional() });
const failure = z.object({ error: z.string().optional(), error_description: z.string().optional() });

/** The LINE Login channel that owns a LIFF app is the numeric prefix of its LIFF ID (`<channelId>-<suffix>`). */
export function liffChannel(liffId: string) {
  return /^(\d+)-/.exec(liffId)?.[1] ?? null;
}

/** Turns LINE's verify error into a specific code so the client can recover and operators can see the cause. */
export function lineVerifyError(description: string | undefined) {
  const reason = description ?? "";
  if (/expired/i.test(reason)) return new ApiError(401, "LINE_TOKEN_EXPIRED", "การเข้าสู่ระบบ LINE หมดอายุ กรุณาเข้าสู่ระบบใหม่");
  if (/audience|client_id/i.test(reason)) {
    return new ApiError(401, "LINE_CHANNEL_MISMATCH", "ร้านตั้งค่า LINE channel ไม่ตรงกับ LIFF app กรุณาแจ้งร้าน");
  }
  return new ApiError(401, "INVALID_LINE_TOKEN", "ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่");
}

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

  const payload: unknown = await response.json().catch(() => null);
  const result = claims.safeParse(response.ok ? payload : null);
  if (result.success) return result.data;

  // LINE's description (for example "IdToken expired.") names the cause; the token itself is never logged.
  const detail = failure.safeParse(payload);
  const description = detail.success ? detail.data.error_description : undefined;
  const error = lineVerifyError(description);
  console.warn("LINE ID token rejected", response.status, error.code, description ?? "no description", `channel ${channelId}`);
  throw error;
}
