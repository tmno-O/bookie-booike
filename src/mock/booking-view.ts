import { today, type Booking } from "./db";

/** Booking as shown to staff, with whether check-in is currently allowed. */
export function staffBookingView(b: Booking) {
  return {
    id: b.id, reference: b.reference, name: b.name, phone: b.phone, serviceDate: b.serviceDate, party: b.party,
    zoneName: b.zoneName, channel: b.channel, status: b.status, checkedInAt: b.checkedInAt ?? null,
    canCheckIn: b.status !== "checked_in" && b.serviceDate === today(),
  };
}
