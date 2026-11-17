import { liffChannel } from "@/lib/auth/line-verify";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkMessagingToken, isBotFriend } from "@/server/line-push";

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";
export type LineCheck = { id: string; status: CheckStatus; title: string; detail: string; fix?: string };

/** Everything the checklist needs, gathered from the database, the server configuration and LINE. */
export type LineFacts = {
  integration: { providerId: string; channelId: string; liffId: string } | null;
  token: "missing" | "unreadable" | "invalid" | "unavailable" | "valid";
  bot: { name: string | null; basicId: string | null } | null;
  verifyReal: boolean;
  pushEnabled: boolean;
  cronSecret: boolean;
  scheduler: "found" | "missing" | "unknown";
  /** Notifications due for more than five minutes that nothing has picked up. */
  backlog: number;
  /** Recent LINE customers checked against the bot's friend list. */
  friends: { checked: number; friends: number } | null;
  /** The last seven days of booking notices. */
  deliveries: { total: number; sent: number; failed: number; topError: string | null };
};

const errorText: Record<string, string> = {
  LINE_PUSH_NOT_CONFIGURED: "ไม่มี token หรือหาบัญชี LINE ของลูกค้าไม่เจอ (Messaging API กับ LINE Login อยู่คนละ provider)",
  INVALID_LINE_CIPHERTEXT: "ถอดรหัส token ไม่ได้ เพราะ LINE_SECRET_KEY เปลี่ยน กรุณาใส่ token ใหม่",
  LINE_HTTP_400: "LINE ปฏิเสธ: ลูกค้ายังไม่ได้เพิ่ม OA เป็นเพื่อน หรือ provider ไม่ตรงกัน",
  LINE_HTTP_401: "token ผิดหรือหมดอายุ",
  LINE_HTTP_403: "OA นี้ไม่มีสิทธิ์ส่งข้อความแบบ push",
  LINE_HTTP_429: "ส่งเกินโควตาข้อความของ LINE OA เดือนนี้ หรือส่งถี่เกินไป",
  LINE_NETWORK_ERROR: "ติดต่อ LINE ไม่ได้ชั่วคราว",
  DELIVERY_WINDOW_EXPIRED: "ค้างส่งนานเกิน 23 ชั่วโมง ระบบจึงเลิกส่ง",
  LEASE_EXHAUSTED: "ส่งไม่สำเร็จครบจำนวนครั้งที่กำหนด",
};

export function explainLineError(code: string | null) {
  if (!code) return "ไม่ทราบสาเหตุ";
  return errorText[code] ?? (code.startsWith("LINE_HTTP_") ? `LINE ตอบกลับรหัส ${code.slice(10)}` : code);
}

export function buildLineChecks(f: LineFacts): LineCheck[] {
  const checks: LineCheck[] = [];
  const add = (check: LineCheck) => checks.push(check);
  const { integration } = f;

  if (!integration) {
    add({ id: "login", status: "fail", title: "LINE Login และ LIFF", detail: "ร้านยังไม่ได้เชื่อม LINE Login",
      fix: "ตั้ง provider, LINE Login channel ID และ LIFF ID ของร้านก่อน ลูกค้าจึงเข้าสู่ระบบด้วย LINE ได้" });
  } else if (liffChannel(integration.liffId) !== integration.channelId) {
    add({ id: "login", status: "fail", title: "LINE Login และ LIFF", detail: `LIFF ${integration.liffId} ไม่ได้อยู่ใน channel ${integration.channelId}`,
      fix: "ใช้ LIFF ID ที่สร้างใน LINE Login channel เดียวกัน" });
  } else {
    add({ id: "login", status: "ok", title: "LINE Login และ LIFF", detail: `channel ${integration.channelId} · LIFF ${integration.liffId}` });
  }

  const tokenFix = "LINE Developers Console → provider เดียวกับ LINE Login → Messaging API channel ของ OA ร้าน → แท็บ Messaging API → "
    + "Channel access token (long-lived) → Issue แล้ววางในช่องด้านบน";
  const botLabel = f.bot?.name ? `OA "${f.bot.name}"${f.bot.basicId ? ` (${f.bot.basicId})` : ""}` : "OA ของร้าน";
  add({
    missing: { id: "token", status: "fail" as const, title: "Messaging API token", detail: "ยังไม่ได้ใส่ token ระบบจึงข้ามทุกข้อความ", fix: tokenFix },
    unreadable: { id: "token", status: "fail" as const, title: "Messaging API token", detail: explainLineError("INVALID_LINE_CIPHERTEXT"), fix: tokenFix },
    invalid: { id: "token", status: "fail" as const, title: "Messaging API token", detail: "LINE ไม่ยอมรับ token ที่บันทึกไว้ (ผิด ถูกยกเลิก หรือหมดอายุ)", fix: tokenFix },
    unavailable: { id: "token", status: "unknown" as const, title: "Messaging API token", detail: "ตรวจกับ LINE ไม่สำเร็จชั่วคราว ลองตรวจอีกครั้ง" },
    valid: { id: "token", status: "ok" as const, title: "Messaging API token", detail: `ใช้งานได้ เชื่อมกับ ${botLabel}` },
  }[f.token]);

  if (!f.verifyReal || !f.pushEnabled) {
    const missing = [!f.verifyReal && "LINE_VERIFY_MODE=real", !f.pushEnabled && "LINE_NOTIFICATIONS_ENABLED=true"].filter(Boolean).join(" และ ");
    add({ id: "server", status: "fail", title: "เปิดการส่งบน server", detail: "server ปิดการส่งข้อความ LINE อยู่",
      fix: `ตั้ง ${missing} ใน Vercel → Settings → Environment Variables แล้ว Redeploy` });
  } else {
    add({ id: "server", status: "ok", title: "เปิดการส่งบน server", detail: "เปิดส่งข้อความ LINE แล้ว" });
  }

  const cronFix = "ตั้ง CRON_SECRET ใน Vercel ให้ตรงกับ bookie_cron_secret ใน Supabase Vault และตั้ง bookie_app_url เป็นโดเมนของเว็บ "
    + "แล้วสร้าง Supabase Cron ตาม docs/DEPLOY.md ข้อ 5";
  if (!f.cronSecret) {
    add({ id: "scheduler", status: "fail", title: "ตัวส่งงานอัตโนมัติ (Cron)", detail: "server ยังไม่มี CRON_SECRET งานที่ส่งไม่ทันจะไม่ถูกส่งซ้ำ", fix: cronFix });
  } else if (f.scheduler === "missing") {
    add({ id: "scheduler", status: "fail", title: "ตัวส่งงานอัตโนมัติ (Cron)", detail: "ไม่พบ Supabase Cron ที่เรียก /api/internal/notifications/drain", fix: cronFix });
  } else if (f.backlog > 0) {
    add({ id: "scheduler", status: "warn", title: "ตัวส่งงานอัตโนมัติ (Cron)", detail: `มีข้อความ ${f.backlog} รายการรอส่งเกิน 5 นาที`, fix: cronFix });
  } else if (f.scheduler === "unknown") {
    add({ id: "scheduler", status: "unknown", title: "ตัวส่งงานอัตโนมัติ (Cron)", detail: "อ่านรายการ Cron ไม่ได้ แต่ไม่มีข้อความค้างส่ง" });
  } else {
    add({ id: "scheduler", status: "ok", title: "ตัวส่งงานอัตโนมัติ (Cron)", detail: "ทำงานอยู่และไม่มีข้อความค้างส่ง" });
  }

  const friendFix = "1) ตรวจว่า Messaging API channel อยู่ provider เดียวกับ LINE Login channel "
    + "2) เปิด Add friend option (Aggressive) ใน LINE Login channel → แท็บ Basic settings เพื่อชวนเพิ่มเพื่อนตอนเข้าสู่ระบบ "
    + "3) แชร์ลิงก์เพิ่มเพื่อนด้านล่างให้ลูกค้า";
  if (f.token !== "valid") {
    add({ id: "friends", status: "unknown", title: "ลูกค้าเป็นเพื่อนกับ OA", detail: "ตรวจได้เมื่อ token ใช้งานได้" });
  } else if (!f.friends?.checked) {
    add({ id: "friends", status: "unknown", title: "ลูกค้าเป็นเพื่อนกับ OA", detail: "ยังไม่มีลูกค้าจองผ่าน LINE ให้ตรวจ" });
  } else if (f.friends.friends === 0) {
    add({ id: "friends", status: "fail", title: "ลูกค้าเป็นเพื่อนกับ OA",
      detail: `ลูกค้าที่จองล่าสุด ${f.friends.checked} คน ไม่มีใครรับข้อความจาก OA นี้ได้`, fix: friendFix });
  } else if (f.friends.friends < f.friends.checked) {
    add({ id: "friends", status: "warn", title: "ลูกค้าเป็นเพื่อนกับ OA",
      detail: `${f.friends.friends} จาก ${f.friends.checked} คนล่าสุดเป็นเพื่อน OA คนที่เหลือจะไม่ได้รับข้อความ`, fix: friendFix });
  } else {
    add({ id: "friends", status: "ok", title: "ลูกค้าเป็นเพื่อนกับ OA", detail: `ลูกค้าล่าสุดทั้ง ${f.friends.checked} คนเป็นเพื่อน OA` });
  }

  const { total, sent, failed, topError } = f.deliveries;
  if (!total) {
    add({ id: "deliveries", status: "unknown", title: "ผลการส่ง 7 วันล่าสุด", detail: "ยังไม่มีข้อความแจ้งเตือนใน 7 วัน" });
  } else if (failed) {
    add({ id: "deliveries", status: sent ? "warn" : "fail", title: "ผลการส่ง 7 วันล่าสุด",
      detail: `ส่งสำเร็จ ${sent} · ไม่สำเร็จ ${failed} · สาเหตุหลัก: ${explainLineError(topError)}`,
      fix: "แก้ข้ออื่นที่ไม่ผ่านก่อน ข้อความที่ไม่สำเร็จแล้วจะไม่ส่งซ้ำ การจองถัดไปจะได้รับข้อความ" });
  } else {
    add({ id: "deliveries", status: sent ? "ok" : "unknown", title: "ผลการส่ง 7 วันล่าสุด",
      detail: sent ? `ส่งสำเร็จ ${sent} รายการ` : "ยังไม่มีข้อความที่ต้องส่งถึงลูกค้า" });
  }
  return checks;
}

export function addFriendUrl(basicId: string | null | undefined) {
  return basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null;
}

export function lineReport(facts: LineFacts) {
  const checks = buildLineChecks(facts);
  return {
    // Warnings (for example some customers who are not friends yet) do not stop notices from going out.
    ready: checks.every((check) => check.status !== "fail"),
    checks,
    bot: facts.bot ? { ...facts.bot, addFriendUrl: addFriendUrl(facts.bot.basicId) } : null,
  };
}

/** Checks every part LINE notifications depend on for one venue. Read-only: no message is sent. */
export async function lineHealth(venueId: string, send: typeof fetch = fetch) {
  const config = env();
  const sql = db();
  const [row] = await sql<{ providerId: string; channelId: string; liffId: string; accessTokenCiphertext: string | null }[]>`
    select provider_id, channel_id, liff_id, access_token_ciphertext from venue_line_integrations where venue_id = ${venueId}
  `;

  let token: LineFacts["token"] = "missing";
  let secret: string | null = null;
  let bot: LineFacts["bot"] = null;
  if (row?.accessTokenCiphertext) {
    try {
      secret = decryptSecret(row.accessTokenCiphertext, `${venueId}:access-token`);
    } catch { token = "unreadable"; }
  }
  if (secret) {
    const check = await checkMessagingToken(secret, send);
    token = check.status;
    if (check.status === "valid") bot = { name: check.botName, basicId: check.basicId };
  }

  let friends: LineFacts["friends"] = null;
  if (row && secret && token === "valid") {
    const recent = await sql<{ subject: string }[]>`
      select i.subject from bookings b
      join customer_identities i on i.customer_id = b.customer_id and i.provider_id = ${row.providerId}
      where b.venue_id = ${venueId} and b.source = 'liff'
      group by i.subject order by max(b.created_at) desc limit 10
    `;
    const answers = await Promise.all(recent.map(({ subject }) => isBotFriend(secret!, subject, send)));
    const known = answers.filter((answer) => answer !== null);
    friends = { checked: known.length, friends: known.filter(Boolean).length };
  }

  const scheduler = await sql<{ jobs: number }[]>`
    select count(*)::int as jobs from cron.job where active and command like '%/api/internal/notifications/drain%'
  `.then(([result]) => result.jobs > 0 ? "found" as const : "missing" as const, () => "unknown" as const);

  const [queue] = await sql<{ backlog: number; total: number; sent: number; failed: number; topError: string | null }[]>`
    with recent as (
      select status, last_error,
        status = 'dead' or (status = 'skipped' and last_error in ('LINE_PUSH_NOT_CONFIGURED', 'INVALID_LINE_CIPHERTEXT')) as failed
      from notification_outbox where venue_id = ${venueId} and created_at > now() - interval '7 days'
    )
    select (select count(*)::int from notification_outbox where venue_id = ${venueId}
        and status in ('pending', 'scheduled') and next_attempt_at < now() - interval '5 minutes') as backlog,
      (select count(*)::int from recent) as total,
      (select count(*)::int from recent where status = 'sent') as sent,
      (select count(*)::int from recent where failed) as failed,
      (select last_error from recent where failed group by last_error order by count(*) desc, last_error limit 1) as top_error
  `;

  return lineReport({
    integration: row ? { providerId: row.providerId, channelId: row.channelId, liffId: row.liffId } : null,
    token, bot,
    verifyReal: config.LINE_VERIFY_MODE === "real",
    pushEnabled: config.LINE_NOTIFICATIONS_ENABLED,
    cronSecret: Boolean(config.CRON_SECRET),
    scheduler, backlog: queue.backlog, friends,
    deliveries: { total: queue.total, sent: queue.sent, failed: queue.failed, topError: queue.topError },
  });
}
