import { randomUUID } from "node:crypto";
import { idempotencyKey } from "@/contracts/booking";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { sha256 } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { body, input, json, route } from "@/lib/http";
import { customerBookingView } from "@/mock/booking-view";
import { activeBooking, addBooking, checkSlot } from "@/mock/booking";
import { withDb } from "@/mock/db";
import { isNightOpen } from "@/mock/schedule";
import { assertMockEnabled, requireUser } from "@/mock/session";
import { bookingInput } from "@/mock/validation";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const bookings = await withDb((db) => {
    const customer = requireUser(db, request).id;
    if (new URL(request.url).searchParams.get("active") === "1") {
      const active = activeBooking(db, customer);
      return active ? [customerBookingView(db, active)] : [];
    }
    return db.bookings.filter((b) => b.customerId === customer && b.status !== "cancelled")
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.createdAt.localeCompare(b.createdAt)).map((b) => customerBookingView(db, b));
  });
  return json({ bookings, nextOffset: null });
});

// Decide mock bookings under the JSON file lock. Replaying a key returns the same booking.
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireSameOrigin(request);
  const payload = await body(request, bookingInput);
  const key = input(idempotencyKey, request.headers.get("idempotency-key"));
  const payloadHash = sha256(JSON.stringify(payload));
  const { booking, created } = await withDb((db) => {
    const customer = requireUser(db, request).id;
    const prior = db.bookingAttempts.find((attempt) => attempt.customerId === customer && attempt.key === key);
    if (prior) {
      if (prior.payloadHash === payloadHash) return { booking: db.bookings.find((b) => b.id === prior.bookingId)!, created: false };
      throw new ApiError(422, "IDEMPOTENCY_CONFLICT", "Idempotency key already used with a different payload");
    }
    const active = activeBooking(db, customer);
    if (active) throw new ApiError(409, "ACTIVE_BOOKING_EXISTS", "คุณมีการจองที่ยังใช้งานอยู่",
      { bookingId: active.id, serviceDate: active.serviceDate });
    const zone = checkSlot(db, payload.serviceDate, payload.zoneId, payload.partyBucket);
    if (!isNightOpen(db, payload.serviceDate)) throw new ApiError(409, "NIGHT_NOT_OPEN", "Booking has not opened for this night yet");
    const made = addBooking(db, {
      requestId: randomUUID(), customerId: customer, name: payload.contactName, phone: payload.contactPhone,
      serviceDate: payload.serviceDate, party: payload.partyBucket, zone, channel: "line",
    });
    db.bookingAttempts.push({ customerId: customer, key, payloadHash, bookingId: made.id });
    return { booking: made, created: true };
  });
  return json({ booking }, { status: created ? 201 : 200 });
});
