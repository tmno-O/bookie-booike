import { z } from "zod";
import { clockTime, instant, serviceDate } from "./common";

export const standardHours = z.strictObject({ daysBefore: z.number().int().min(0).max(365), time: clockTime });
export const weekdaysInput = z.strictObject({
  openWeekdays: z.array(z.number().int().min(0).max(6)).max(7)
    .refine((days) => new Set(days).size === days.length),
});
export const serviceHoursInput = z.strictObject({
  openWeekdays: weekdaysInput.shape.openWeekdays,
  serviceStart: clockTime,
  serviceEnd: clockTime,
}).refine((hours) => hours.serviceStart !== hours.serviceEnd, "เวลาเปิดและเวลาปิดต้องไม่เท่ากัน");
export const closureInput = z.strictObject({ serviceDate, reason: z.string().trim().max(300).default("") });
export const closureView = closureInput.extend({ affectedBookings: z.number().int().nonnegative() });
export const specialHours = z.strictObject({ serviceDate, opensOn: serviceDate, time: clockTime })
  .refine((value) => value.opensOn <= value.serviceDate, "วันเปิดรับจองต้องไม่เกินคืนที่จอง");
export const hoursData = z.object({
  standard: standardHours,
  specials: z.array(z.object({ id: serviceDate, serviceDate, opensOn: serviceDate, time: clockTime, opensAt: instant })),
  canEdit: z.literal(true),
  openWeekdays: weekdaysInput.shape.openWeekdays,
  closures: z.array(closureView),
  service: z.object({ start: clockTime, end: clockTime }),
});
