import { decryptSecret } from "@/lib/crypto";

export type Delivery = { status: "retry" | "sent" | "skipped" | "dead"; error: string | null };
export type LineRecipient = { id: string; venueId: string; subject: string | null; accessTokenCiphertext: string | null; stale: boolean };

export async function sendLinePush(job: LineRecipient, messages: object[], send: typeof fetch = fetch): Promise<Delivery> {
  if (!job.accessTokenCiphertext || !job.subject) return { status: "skipped", error: "LINE_PUSH_NOT_CONFIGURED" };
  if (job.stale) return { status: "dead", error: "DELIVERY_WINDOW_EXPIRED" };
  let token: string;
  try { token = decryptSecret(job.accessTokenCiphertext, `${job.venueId}:access-token`); }
  catch { return { status: "dead", error: "INVALID_LINE_CIPHERTEXT" }; }
  const response = await send("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": job.id },
    signal: AbortSignal.timeout(5_000), body: JSON.stringify({ to: job.subject, messages }),
  }).catch(() => null);
  if (!response) return { status: "retry", error: "LINE_NETWORK_ERROR" };
  if (response.ok || (response.status === 409 && response.headers.has("x-line-accepted-request-id"))) return { status: "sent", error: null };
  return { status: response.status >= 500 || response.status === 429 ? "retry" : "dead", error: `LINE_HTTP_${response.status}` };
}
