import { today, type Booking } from "./db";

/** Booking as shown to staff, with whether check-in is currently allowed. */
export function staffBookingView(b: Booking) {
  return {
    id: b.id, reference: b.reference, name: b.name, phone: b.phone, serviceDate: b.serviceDate, party: b.party,
    zoneName: b.zoneName, channel: b.channel, status: b.status, checkedInAt: b.checkedInAt ?? null,
    canCheckIn: b.status !== "checked_in" && b.serviceDate === today(),
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
