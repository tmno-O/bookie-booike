import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { addDays, today, zoneAvailability, type Booking, type Db, type Zone } from "./db";
import { isServiceNightOpen } from "./schedule";

/** Shared slot check: bookable date window, known zone, free table. Throws an ApiError otherwise. */
export function checkSlot(db: Db, serviceDate: string, zoneId: string): Zone {
  if (serviceDate < today() || serviceDate > addDays(today(), db.venue.maxAdvanceDays)) {
    throw new ApiError(422, "DATE_OUT_OF_RANGE", "Date is outside the bookable window");
  }
  return ensureCapacity(db, serviceDate, zoneId);
}

/** Known zone with a free table that night (pending requests do not hold tables). */
export function ensureCapacity(db: Db, serviceDate: string, zoneId: string): Zone {
  if (!isServiceNightOpen(db, serviceDate)) throw new ApiError(409, "CLOSED", "ร้านปิดในคืนนี้");
  const zone = db.zones.find((z) => z.id === zoneId);
  if (!zone) throw new ApiError(422, "ZONE_NOT_FOUND", "Zone not found");
  if (zone.status === "closed") throw new ApiError(409, "ZONE_CLOSED", "This zone is not open for booking");
  if (!zoneAvailability(db, serviceDate).find((z) => z.id === zone.id)!.available) {
    throw new ApiError(409, "ZONE_FULL", "This zone is full for the selected night");
  }
  return zone;
}

export function addBooking(db: Db, data: {
  requestId: string; customerId: string; name: string; phone: string; serviceDate: string; party: string;
  zone: Zone; channel: Booking["channel"]; requestedAt?: string;
}): Booking {
  if (data.party === "12+" && db.largePartyMode === "disabled") {
    throw new ApiError(409, "LARGE_PARTY_DISABLED", "ร้านไม่รับจองออนไลน์สำหรับกลุ่มเกิน 12 คน กรุณาติดต่อร้าน");
  }
  db.seq += 1;
  const booking: Booking = {
    id: randomUUID(), reference: `BL-${data.serviceDate.slice(0, 4)}-${String(db.seq).padStart(4, "0")}`,
    requestId: data.requestId, customerId: data.customerId, name: data.name, phone: data.phone,
    serviceDate: data.serviceDate, party: data.party, zoneId: data.zone.id, zoneName: data.zone.name,
    createdAt: new Date().toISOString(), status: data.party === "12+" ? "pending" : "confirmed", channel: data.channel,
    ...(data.channel === "line" && {
      queueNo: Math.max(0, ...db.bookings.map((b) => b.queueNo ?? 0)) + 1,
      requestedAt: data.requestedAt ?? new Date().toISOString(),
    }),
  };
  db.bookings.push(booking);
  return booking;
}
