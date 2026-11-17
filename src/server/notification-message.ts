import { bookingLoginQuery, bookingPath, type BookingDestination } from "@/lib/booking-links";
import { env } from "@/lib/env";

const titles = {
  received: "ได้รับคำขอ รอร้านยืนยัน",
  confirmed: "ยืนยันการจองแล้ว",
  cancelled: "ยกเลิกการจองแล้ว",
  reminder: "เตือนก่อนถึงวันจอง",
  rejected: "จองไม่สำเร็จ",
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
  venueAddress?: string | null;
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
const serviceDate = (day: string) => formatDate.format(new Date(`${day}T00:00:00Z`));
const text = (value: string) => ({ type: "text", text: value, wrap: true });
function flex(title: string, lines: object[], label: string, uri: string | null) {
  return {
    type: "flex",
    altText: title,
    contents: { type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [{ ...text(title), weight: "bold", size: "lg" }, ...lines] },
      ...(uri && { footer: { type: "box", layout: "vertical", contents: [{ type: "button", height: "sm", action: { type: "uri", label, uri } }] } }),
    },
  };
}

export function bookingNoticeMessage(data: BookingNotice, origin?: string) {
  const date = `${serviceDate(data.serviceDate)}${data.serviceTime ? ` เวลา ${data.serviceTime} น.` : ""}`;
  const detail = data.kind === "rejected"
    ? rejectionReasons[data.resultCode ?? ""] ?? "ไม่สามารถยืนยันการจองรอบนี้ได้ กรุณาลองใหม่"
    : data.note;
  const summary = data.kind === "confirmed" ? [
    text(`วันจอง ${serviceDate(data.serviceDate)}`),
    ...(data.serviceTime ? [text(`เวลา ${data.serviceTime} น.`)] : []),
    text(`สถานที่จอง ${data.name}`),
    ...(data.venueAddress?.trim() ? [text(data.venueAddress.trim())] : []),
  ] : [text(data.name), text(`คืนบริการ ${date}`)];
  const lines = [...summary,
    ...(data.zoneName ? [text(`โซน ${data.zoneName}`)] : []),
    ...(data.partySize ? [text(`จำนวน ${data.partySize} คน`)] : []),
    ...(data.reference ? [text(`เลขอ้างอิง ${data.reference}`)] : []), ...(detail ? [text(detail)] : [])];
  return flex(titles[data.kind], lines, "ดูการจองของฉัน", lineLink(data, "bookings", origin));
}

export function releaseNoticeMessage(data: ReleaseNotice, origin?: string, now = Date.now()) {
  const title = `${data.reminder ? "เตือนวันพิเศษ" : "รอบใหม่"}: ${data.title}`;
  const lines = [text(data.name), text(`คืนบริการ ${serviceDate(data.serviceDate)}`)];
  if (!data.reminder || data.opensAt.getTime() > now) {
    const opens = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
      dateStyle: "medium", timeStyle: "short", timeZone: data.timezone, hourCycle: "h23",
    }).format(data.opensAt);
    lines.push(text(`เปิดจอง ${opens} น.`));
  }
  return flex(title, lines, "ดูรอบจอง", lineLink(data, "select", origin, data.serviceDate));
}
