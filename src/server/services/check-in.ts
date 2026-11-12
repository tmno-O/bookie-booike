import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { getStaffBooking } from "./bookings";

const failures = {
  ALREADY_CHECKED_IN: "การจองนี้เช็กอินแล้ว",
  NOT_SERVICE_DATE: "เช็กอินได้เฉพาะในคืนที่จอง",
  BOOKING_NOT_CONFIRMED: "เช็กอินได้เฉพาะการจองที่ยืนยันแล้ว",
};

export async function checkInBooking(staff: Staff, bookingId: string) {
  const [result] = await db()<{
    code: keyof typeof failures | "NOT_FOUND" | "CHECKED_IN";
  }[]>`select check_in_booking(${staff.venueId}, ${bookingId}, ${staff.userId}) as code`;
  if (result.code === "NOT_FOUND") notFound("Booking");
  if (result.code !== "CHECKED_IN") throw new ApiError(409, result.code, failures[result.code]);
  return getStaffBooking(staff.venueId, bookingId);
}
