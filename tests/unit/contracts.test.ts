import { expect, it } from "vitest";
import { customerBookingInput, requestStatus } from "@/contracts/booking";
import { errorResponse } from "@/contracts/common";
import { availability, venuePublic } from "@/contracts/venue";
import booking from "../../docs/fixtures/booking-request.json";
import status from "../../docs/fixtures/booking-status.json";
import error from "../../docs/fixtures/error.json";
import venue from "../../docs/fixtures/venue.json";
import tables from "../../docs/fixtures/availability.json";
import { closureInput, serviceHoursInput, weekdaysInput } from "@/contracts/hours";

it("validates closures and unique weekdays, including closing every day", () => {
  expect(weekdaysInput.safeParse({ openWeekdays: [] }).success).toBe(true);
  expect(weekdaysInput.safeParse({ openWeekdays: [1, 1] }).success).toBe(false);
  expect(closureInput.safeParse({ serviceDate: "2026-02-30", reason: "Holiday" }).success).toBe(false);
  expect(closureInput.parse({ serviceDate: "2026-12-01", reason: " Holiday " }).reason).toBe("Holiday");
});

it("validates the service window and allows it to run past midnight", () => {
  const hours = { openWeekdays: [1, 2], serviceStart: "18:00", serviceEnd: "02:00" };
  expect(serviceHoursInput.safeParse(hours).success).toBe(true);
  expect(serviceHoursInput.safeParse({ ...hours, serviceEnd: "18:00" }).success).toBe(false);
  expect(serviceHoursInput.safeParse({ ...hours, serviceStart: "6pm" }).success).toBe(false);
});

it("validates client fixtures", () => {
  expect(customerBookingInput.parse(booking)).toEqual(booking);
  expect(requestStatus.parse(status)).toEqual(status);
  expect(errorResponse.parse(error)).toEqual(error);
  expect(venuePublic.parse(venue)).toEqual(venue);
  expect(availability.parse(tables)).toEqual(tables);
});
it("rejects conflicting booking targets and impossible dates", () => {
  expect(customerBookingInput.safeParse({ ...booking, zoneId: booking.tableId }).success).toBe(false);
  expect(customerBookingInput.safeParse({ ...booking, serviceDate: "2026-02-30" }).success).toBe(false);
});
