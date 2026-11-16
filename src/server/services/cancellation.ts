import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { getBooking } from "./bookings";

export async function cancelBooking(venueId: string, bookingId: string, type: "customer" | "staff", actorId: string) {
  const [result] = await db()<{
    code: "NOT_FOUND" | "CUTOFF_PASSED" | "CANCEL_DISABLED" | "ALREADY_CHECKED_IN" | "CANCELLED";
  }[]>`select cancel_booking(${venueId}, ${bookingId}, ${type}, ${actorId}) as code`;
  if (result.code === "NOT_FOUND") notFound("Booking");
  if (result.code === "CANCEL_DISABLED") throw new ApiError(409, "CANCEL_DISABLED", "ร้านปิดการยกเลิกด้วยตนเอง กรุณาติดต่อร้าน");
  if (result.code === "ALREADY_CHECKED_IN") throw new ApiError(409, result.code, "Checked-in bookings cannot be cancelled");
  if (result.code === "CUTOFF_PASSED") {
    throw new ApiError(409, "CANCELLATION_CUTOFF_PASSED", "The customer cancellation cutoff has passed");
  }
  return getBooking({ venueId, customerId: type === "customer" ? actorId : undefined }, bookingId);
}
