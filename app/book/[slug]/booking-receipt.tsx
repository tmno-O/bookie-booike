import type { Booking } from "./flow";

const timestamp = (iso: string) => new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  fractionalSecondDigits: 3, hourCycle: "h23", timeZone: "Asia/Bangkok",
}).format(new Date(iso));

export function BookingReceipt({ booking }: { booking: Booking }) {
  const receipt = booking.receipt;
  if (!receipt) return null;
  return <details style={{ marginBlock: 16 }}>
    <summary style={{ minHeight: 44, cursor: "pointer" }}>หลักฐานการจอง · {receipt.verifyCode}</summary>
    <p>เลขอ้างอิง {receipt.reference}<br />เลข ticket {receipt.ticketSeq ?? "จองโดยไม่มี ticket"}<br />
      รับคำขอ {timestamp(receipt.receivedAt)}<br />ตัดสิน {receipt.decidedAt ? timestamp(receipt.decidedAt) : "ยังไม่ตัดสิน"}<br />
      รหัสตรวจสอบ <code>{receipt.verifyCode}</code></p>
    <p>ตำแหน่งคิวเปลี่ยนตามเวลา ใช้เลขอ้างอิงและรหัสตรวจสอบเทียบกับข้อมูลร้าน</p>
  </details>;
}
