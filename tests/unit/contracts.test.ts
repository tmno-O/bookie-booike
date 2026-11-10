import { expect, it } from "vitest";
import { customerBookingInput, requestStatus } from "@/contracts/booking";
import { errorResponse } from "@/contracts/common";
import booking from "../../docs/fixtures/booking-request.json";
import status from "../../docs/fixtures/booking-status.json";
import error from "../../docs/fixtures/error.json";

it("validates client fixtures", () => {
  expect(customerBookingInput.parse(booking)).toEqual(booking);
  expect(requestStatus.parse(status)).toEqual(status);
  expect(errorResponse.parse(error)).toEqual(error);
});
it("rejects conflicting booking targets and impossible dates", () => {
  expect(customerBookingInput.safeParse({ ...booking, zoneId: booking.tableId }).success).toBe(false);
  expect(customerBookingInput.safeParse({ ...booking, serviceDate: "2026-02-30" }).success).toBe(false);
});
