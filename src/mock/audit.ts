import { createHash } from "node:crypto";
import type { AuditEntry } from "@/contracts/audit";
import type { Booking, Db } from "./db";

export const mockBookingHash = (b: Booking) => createHash("sha256")
  .update(JSON.stringify([b.id, b.reference, b.requestId, b.createdAt])).digest("hex");

export function mockAuditEntries(db: Db, date?: string, bookingId?: string): AuditEntry[] {
  const rows = db.bookings.filter((b) => (!date || b.serviceDate === date) && (!bookingId || b.id === bookingId));
  const entries = rows.flatMap((b) => {
    const receivedAt = b.requestedAt ?? b.createdAt;
    const base = { id: "0", seq: "0", actor: b.channel === "line" ? "customer" : "staff",
      reference: b.reference, phone: `***${b.phone.slice(-4)}`, ticketSeq: b.queueNo ? String(b.queueNo) : null,
      queueSeq: b.queueNo ? String(b.queueNo) : null, receivedAt, decidedAt: b.createdAt,
      tableId: null, zoneId: b.zoneId, tableName: null, zoneName: b.zoneName, rowHash: mockBookingHash(b) };
    return [
      { ...base, action: "booking.request_received", createdAt: receivedAt, resultCode: "QUEUED" },
      { ...base, action: b.status === "pending" ? "booking.pending_allocation" : "booking.confirmed", createdAt: b.createdAt, resultCode: b.status === "pending" ? "PENDING_ALLOCATION" : "CONFIRMED" },
      ...(b.cancelledAt ? [{ ...base, action: "booking.cancelled", createdAt: b.cancelledAt, resultCode: "CANCELLED" }] : []),
    ];
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return entries.map((row, i) => ({ ...row, id: String(i + 1), seq: String(i + 1) }));
}
