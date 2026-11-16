import { today, type Booking, type Db } from "./db";
import { ApiError, notFound } from "@/lib/errors";
import { mockBookingHash } from "./audit";

export function customerBookingView(db: Db, b: Booking) {
  const deadline = db.cancellation.customerCancelEnabled
    ? new Date(Date.parse(`${b.serviceDate}T18:00:00+07:00`) - db.cancellation.cancelCutoffMinutes * 60_000).toISOString() : null;
  return { ...b, cancellableUntil: deadline, receipt: { reference: b.reference, queueSeq: b.queueNo ? String(b.queueNo) : null,
    receivedAt: b.requestedAt ?? b.createdAt, decidedAt: b.createdAt, verifyCode: mockBookingHash(b).slice(0, 16) },
    canCancel: (b.status === "confirmed" || b.status === "pending") && !!deadline && Date.now() < Date.parse(deadline) };
}

export function cancelMockBooking(db: Db, id: string, customerId?: string) {
  const b = db.bookings.find((b) => b.id === id && (!customerId || b.customerId === customerId));
  if (!b) notFound("Booking");
  if (b.status === "cancelled") return customerBookingView(db, b);
  if (b.status === "checked_in") throw new ApiError(409, "ALREADY_CHECKED_IN", "Checked-in bookings cannot be cancelled");
  if (customerId) {
    if (!db.cancellation.customerCancelEnabled) throw new ApiError(409, "CANCEL_DISABLED", "ร้านปิดการยกเลิกด้วยตนเอง กรุณาติดต่อร้าน");
    if (!customerBookingView(db, b).canCancel) throw new ApiError(409, "CANCELLATION_CUTOFF_PASSED", "เลยกำหนดยกเลิก ติดต่อร้าน");
  }
  b.status = "cancelled"; b.cancelledAt = new Date().toISOString();
  return customerBookingView(db, b);
}

/** Booking as shown to staff, with whether check-in is currently allowed. */
export function staffBookingView(b: Booking) {
  return {
    id: b.id, reference: b.reference, name: b.name, phone: b.phone, serviceDate: b.serviceDate, party: b.party,
    zoneName: b.zoneName, channel: b.channel, status: b.status, checkedInAt: b.checkedInAt ?? null,
    canCheckIn: b.status !== "checked_in" && b.status !== "cancelled" && b.serviceDate === today(),
  };
}

/** Customer request as shown on the staff queue page. */
export function queueRowView(b: Booking) {
  return {
    id: b.id, queueNo: b.queueNo ?? 0, requestedAt: b.requestedAt ?? b.createdAt, name: b.name, phone: b.phone,
    serviceDate: b.serviceDate, party: b.party, zoneId: b.zoneId, zoneName: b.zoneName,
    status: b.status === "pending" ? ("pending" as const) : ("allocated" as const),
  };
}
