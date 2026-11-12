import { requestStatus } from "@/contracts/booking";
import { apiRequest, type ApiFailure } from "./transport";

export async function waitForBooking(path: string, signal?: AbortSignal, ticketUsed = false) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = requestStatus.parse(await apiRequest(path, { signal }));
    if (result.bookingId) return { booking: { id: result.bookingId } };
    if (result.status === "rejected") {
      throw {
        status: 409, code: result.resultCode ?? "BOOKING_REJECTED",
        message: "คำขอจองไม่สำเร็จ", ticketUsed, requestFinal: true,
      } satisfies ApiFailure;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    signal?.throwIfAborted();
  }
  throw {
    status: 503, code: "BOOKING_PROCESSING", message: "กำลังดำเนินการจอง กรุณาดูสถานะคำขออีกครั้ง", ticketUsed,
  } satisfies ApiFailure;
}
