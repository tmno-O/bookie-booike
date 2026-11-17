import { decryptSecret } from "@/lib/crypto";

export type Delivery = { status: "retry" | "sent" | "skipped" | "dead"; error: string | null };
export type LineRecipient = { id: string; venueId: string; subject: string | null; accessTokenCiphertext: string | null; stale: boolean };
type LineSender = { retryKey: string; venueId: string; accessTokenCiphertext: string | null };

/** Calls a LINE Messaging API send endpoint with a stable retry key, so a retried request is never delivered twice. */
async function sendLine(path: "push" | "multicast", sender: LineSender, body: object, send: typeof fetch): Promise<Delivery> {
  if (!sender.accessTokenCiphertext) return { status: "skipped", error: "LINE_PUSH_NOT_CONFIGURED" };
  let token: string;
  try { token = decryptSecret(sender.accessTokenCiphertext, `${sender.venueId}:access-token`); }
  catch { return { status: "dead", error: "INVALID_LINE_CIPHERTEXT" }; }
  let response: Response;
  try {
    response = await send(`https://api.line.me/v2/bot/message/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": sender.retryKey },
      signal: AbortSignal.timeout(5_000), body: JSON.stringify(body),
    });
  } catch { return { status: "retry", error: "LINE_NETWORK_ERROR" }; }
  if (response.ok || (response.status === 409 && response.headers.has("x-line-accepted-request-id"))) return { status: "sent", error: null };
  return { status: response.status >= 500 || response.status === 429 ? "retry" : "dead", error: `LINE_HTTP_${response.status}` };
}

export async function sendLinePush(job: LineRecipient, messages: object[], send: typeof fetch = fetch): Promise<Delivery> {
  if (!job.accessTokenCiphertext || !job.subject) return { status: "skipped", error: "LINE_PUSH_NOT_CONFIGURED" };
  if (job.stale) return { status: "dead", error: "DELIVERY_WINDOW_EXPIRED" };
  return sendLine("push", { retryKey: job.id, venueId: job.venueId, accessTokenCiphertext: job.accessTokenCiphertext },
    { to: job.subject, messages }, send);
}

/** LINE accepts at most 500 recipients per multicast request. */
export const MULTICAST_LIMIT = 500;

export function sendLineMulticast(
  sender: LineSender, recipients: string[], messages: object[], send: typeof fetch = fetch,
): Promise<Delivery> {
  if (!recipients.length) return Promise.resolve({ status: "skipped", error: "NO_RECIPIENTS" });
  if (recipients.length > MULTICAST_LIMIT) throw new Error("Too many multicast recipients");
  return sendLine("multicast", sender, { to: recipients, messages }, send);
}

export type MessagingTokenCheck = { status: "valid"; botName: string | null; basicId: string | null } | { status: "invalid" | "unavailable" };

/** Asks LINE which bot a Messaging API channel access token belongs to, so a wrong token is refused before it is saved. */
export async function checkMessagingToken(token: string, send: typeof fetch = fetch): Promise<MessagingTokenCheck> {
  let response: Response;
  try {
    response = await send("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000), cache: "no-store",
    });
  } catch { return { status: "unavailable" }; }
  if (response.status === 401 || response.status === 403) return { status: "invalid" };
  if (!response.ok) return { status: "unavailable" };
  const info: unknown = await response.json().catch(() => null);
  const text = (key: string) => info && typeof info === "object" && key in info
    && typeof (info as Record<string, unknown>)[key] === "string" ? (info as Record<string, string>)[key] : null;
  return { status: "valid", botName: text("displayName"), basicId: text("basicId") };
}

/** True when the user has added the bot as a friend. LINE only knows the user when the bot shares the LINE Login provider. */
export async function isBotFriend(token: string, userId: string, send: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const response = await send(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000), cache: "no-store",
    });
    if (response.ok) return true;
    return response.status === 404 ? false : null;
  } catch { return null; }
}
