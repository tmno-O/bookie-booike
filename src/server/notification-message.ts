import { bookingLoginQuery, bookingPath, type BookingDestination } from "@/lib/booking-links";
import { env } from "@/lib/env";

const titles = {
  received: "ได้รับคำขอ รอร้านยืนยัน",
  confirmed: "ยืนยันการจองแล้ว",
  cancelled: "ยกเลิกการจองแล้ว",
  reminder: "เตือนก่อนถึงวันจอง",
  rejected: "จองไม่สำเร็จ",
  day_of: "วันนี้มีการจองของคุณ",
  cancel_deadline: "ใกล้หมดเวลายกเลิกการจอง",
  checked_in: "เช็กอินแล้ว ยินดีต้อนรับ",
  thank_you: "ขอบคุณที่มาใช้บริการ",
};

const rejectionReasons: Record<string, string> = {
  ACTIVE_BOOKING_EXISTS: "คุณมีการจองเดิมที่ยังใช้งานอยู่ กรุณาตรวจสอบการจองของคุณ",
  TABLE_UNAVAILABLE: "โต๊ะที่เลือกไม่ว่าง",
  ZONE_FULL: "โซนที่เลือกเต็มแล้ว",
  ZONE_CLOSED: "โซนที่เลือกปิดรับจอง",
  CLOSED: "ร้านปิดในคืนที่เลือก",
  BOOKING_CLOSED: "คืนที่เลือกปิดรับจองแล้ว",
  NIGHT_NOT_OPEN: "คืนที่เลือกยังไม่เปิดจอง",
  DATE_OUT_OF_RANGE: "คืนที่เลือกอยู่นอกช่วงเปิดจอง",
  TOO_FAR_AHEAD: "คืนที่เลือกอยู่นอกช่วงเปิดจองของโซน",
  SYSTEM_ERROR: "ระบบไม่สามารถยืนยันการจองได้ กรุณาลองใหม่",
};

type VenueLink = { slug: string; name: string; liffId: string | null };
export type BookingNotice = VenueLink & {
  kind: keyof typeof titles; serviceDate: string; serviceTime: string | null; zoneName: string | null;
  venueAddress?: string | null; entryPolicy?: string | null; cancelByDate?: string | null; cancelByTime?: string | null;
  partySize: number | null; reference: string | null; resultCode: string | null; note: string | null;
};
type ReleaseNotice = VenueLink & {
  title: string; serviceDate: string; opensAt: Date; timezone: string; reminder: boolean;
};

export function notificationOrigin() {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return env().BOOKING_PUBLIC_ORIGIN ?? (productionHost ? `https://${productionHost}` : undefined);
}

function lineLink(venue: VenueLink, page: BookingDestination, origin?: string, date?: string) {
  if (venue.liffId && /^\d+-[A-Za-z0-9]+$/.test(venue.liffId)) {
    return `https://liff.line.me/${venue.liffId}/${bookingLoginQuery(page, date)}`;
  }
  return origin ? new URL(bookingPath(venue.slug, page, date), origin).href : null;
}

const formatDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { dateStyle: "medium", timeZone: "UTC" });
const formatLongDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
const serviceDate = (day: string) => formatDate.format(new Date(`${day}T00:00:00Z`));
const longDate = (day: string) => formatLongDate.format(new Date(`${day}T00:00:00Z`));

/** Colours from the booking app: each message type has one accent for its header and button. */
const tone = {
  brand: "#B94E29", success: "#2F7A55", waiting: "#B7791F", muted: "#6B625D", danger: "#B3261E",
} as const;
type Tone = keyof typeof tone;
const ink = "#25211F", soft = "#8A817C", paper = "#F7F3EF";

type Row = [label: string, value: string | null | undefined];
type Card = {
  tone: Tone; eyebrow: string; title: string; subtitle?: string | null; rows: Row[];
  reference?: string | null; callout?: string | null; button?: { label: string; uri: string | null };
};

const textBox = (value: string, style: object = {}) => ({ type: "text", text: value, wrap: true, ...style });

function row([label, value]: Row) {
  return { type: "box", layout: "horizontal", spacing: "md", contents: [
    textBox(label, { size: "sm", color: soft, flex: 2 }),
    textBox(value!, { size: "sm", color: ink, weight: "bold", flex: 5 }),
  ] };
}

/** One bubble layout for every notice: coloured header, detail rows, reference chip, note and one button. */
function card({ tone: name, eyebrow, title, subtitle, rows, reference, callout, button }: Card, altText = title) {
  const color = tone[name];
  const details = rows.filter(([, value]) => value?.trim()).map(row);
  const body = [
    ...(details.length ? [{ type: "box", layout: "vertical", spacing: "sm", contents: details }] : []),
    ...(reference ? [{ type: "box", layout: "vertical", backgroundColor: paper, cornerRadius: "md", paddingAll: "12px", contents: [
      textBox("เลขอ้างอิง", { size: "xxs", color: soft }),
      textBox(reference, { size: "lg", color: ink, weight: "bold" }),
    ] }] : []),
    ...(callout ? [{ type: "box", layout: "vertical", borderColor: color, borderWidth: "1px", cornerRadius: "md", paddingAll: "12px",
      contents: [textBox(callout, { size: "sm", color })] }] : []),
  ];
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: color, paddingAll: "20px", spacing: "sm", contents: [
        textBox(eyebrow, { size: "xs", color: "#FFFFFFCC", weight: "bold" }),
        textBox(title, { size: "xl", color: "#FFFFFF", weight: "bold" }),
        ...(subtitle ? [textBox(subtitle, { size: "sm", color: "#FFFFFFE6" })] : []),
      ] },
      body: { type: "box", layout: "vertical", spacing: "lg", paddingAll: "20px", contents: body.length ? body : [textBox(" ")] },
      ...(button?.uri && { footer: { type: "box", layout: "vertical", paddingAll: "16px", contents: [
        { type: "button", style: "primary", color, height: "sm", action: { type: "uri", label: button.label, uri: button.uri } },
      ] } }),
    },
  };
}

/** Every text a customer sees in a message, in reading order. Rows read as "label value". */
export function flexTexts(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const value = node as Record<string, unknown>;
  if (value.type === "box" && value.layout === "horizontal" && Array.isArray(value.contents)) {
    return [value.contents.flatMap(flexTexts).join(" ")];
  }
  const own = value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  const action = value.type === "button" ? value.action as { label?: unknown } | undefined : undefined;
  const label = typeof action?.label === "string" ? [action.label] : [];
  const children = ["contents", "header", "body", "footer"].flatMap((key) => {
    const child = value[key];
    return Array.isArray(child) ? child.flatMap(flexTexts) : flexTexts(child);
  });
  return [...own, ...label, ...children];
}

function bookingCard(data: BookingNotice, origin?: string): Card {
  const time = data.serviceTime ? `${data.serviceTime} น.` : null;
  const party = data.partySize ? `${data.partySize} คน` : null;
  const when: Row[] = [["วันที่", longDate(data.serviceDate)], ["เวลา", time]];
  const seat: Row[] = [["โซน", data.zoneName], ["จำนวน", party]];
  const place: Row = ["สถานที่", data.venueAddress?.trim()];
  const mine = { label: "ดูการจองของฉัน", uri: lineLink(data, "bookings", origin) };
  const again = { label: "เลือกคืนอื่น", uri: lineLink(data, "select", origin) };
  const base = { eyebrow: data.name, title: titles[data.kind], reference: data.reference };
  switch (data.kind) {
    case "received":
      return { ...base, tone: "waiting", subtitle: "ร้านกำลังจัดโต๊ะให้ และจะแจ้งผลทาง LINE", rows: [...when, ...seat], button: mine };
    case "confirmed":
      return { ...base, tone: "success", subtitle: `แล้วพบกันที่ ${data.name}`, rows: [...when, ...seat, place], callout: data.note, button: mine };
    case "cancelled":
      return { ...base, tone: "muted", subtitle: data.note ?? "การจองนี้ถูกยกเลิกเรียบร้อย", rows: [...when, ...seat], button: again };
    case "rejected":
      return { ...base, tone: "danger", reference: null,
        subtitle: rejectionReasons[data.resultCode ?? ""] ?? "ไม่สามารถยืนยันการจองรอบนี้ได้ กรุณาลองใหม่",
        rows: [["วันที่", longDate(data.serviceDate)], ["โซน", data.zoneName], ["จำนวน", party]], button: again };
    case "reminder":
      return { ...base, tone: "brand", subtitle: "อย่าลืมการจองของคุณ", rows: [...when, ...seat, place], button: mine };
    case "day_of":
      return { ...base, tone: "brand", subtitle: time ? `พบกันคืนนี้ ${time}` : "พบกันคืนนี้", rows: [...seat, place],
        callout: data.entryPolicy?.trim() ? `นโยบายเข้าร้าน: ${data.entryPolicy.trim()}` : null, button: mine };
    case "cancel_deadline":
      return { ...base, tone: "waiting",
        subtitle: data.cancelByDate && data.cancelByTime ? `ยกเลิกได้ถึง ${serviceDate(data.cancelByDate)} เวลา ${data.cancelByTime} น.` : null,
        rows: [...when, ...seat], callout: "หากไม่สะดวกมา กรุณายกเลิกเพื่อเปิดที่ให้ลูกค้าท่านอื่น",
        button: { label: "จัดการการจอง", uri: mine.uri } };
    case "checked_in":
      return { ...base, tone: "success", subtitle: "เช็กอินเรียบร้อย ขอให้สนุกกับค่ำคืนนี้", rows: seat, button: mine };
    case "thank_you":
      return { ...base, tone: "brand", reference: null, subtitle: "หวังว่าจะได้พบกันอีก",
        rows: [["มาเมื่อ", longDate(data.serviceDate)], ["โซน", data.zoneName]],
        button: { label: "จองครั้งถัดไป", uri: lineLink(data, "select", origin) } };
  }
}

export function bookingNoticeMessage(data: BookingNotice, origin?: string) {
  return card(bookingCard(data, origin));
}

export function releaseNoticeMessage(data: ReleaseNotice, origin?: string, now = Date.now()) {
  const title = `${data.reminder ? "เตือนวันพิเศษ" : "รอบใหม่"}: ${data.title}`;
  const opens = !data.reminder || data.opensAt.getTime() > now ? new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium", timeStyle: "short", timeZone: data.timezone, hourCycle: "h23",
  }).format(data.opensAt) : null;
  return card({
    tone: "brand", eyebrow: data.name, title: data.reminder ? "เตือนวันพิเศษ" : "เปิดรอบจองใหม่", subtitle: data.title,
    rows: [["คืนบริการ", longDate(data.serviceDate)], ["เปิดจอง", opens ? `${opens} น.` : null]],
    callout: data.reminder ? "ใกล้ถึงวันพิเศษแล้ว จองไว้ก่อนเต็ม" : null,
    button: { label: "ดูรอบจอง", uri: lineLink(data, "select", origin, data.serviceDate) },
  }, title);
}
