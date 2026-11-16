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
const closureFields = { serviceDate, reason: z.string().trim().max(300).default("") };
/** `bookings` is required when the night already has bookings: keep them, or cancel and notify each guest. */
export const closureInput = z.strictObject({ ...closureFields, bookings: z.enum(["keep", "cancel"]).optional() });
export const closureView = z.object({ ...closureFields, affectedBookings: z.number().int().nonnegative() });
export const specialHours = z.strictObject({ serviceDate, opensOn: serviceDate, time: clockTime,
  title: z.string().trim().max(120).default(""), announce: z.boolean().default(false) })
  .refine((value) => value.opensOn <= value.serviceDate, "วันเปิดรับจองต้องไม่เกินคืนที่จอง")
  .refine((value) => !value.announce || !!value.title, "กรุณาระบุชื่อวันพิเศษก่อนแจ้งลูกค้า");
export const hoursData = z.object({
  standard: standardHours,
  maxAdvanceDays: z.number().int().min(0).max(365), timezone: z.string(),
  specials: z.array(z.object({ id: serviceDate, serviceDate, opensOn: serviceDate, time: clockTime, opensAt: instant,
    title: z.string(), recipients: z.number().int(), sent: z.number().int(), failed: z.number().int() })),
  canEdit: z.literal(true),
  openWeekdays: weekdaysInput.shape.openWeekdays,
  closures: z.array(closureView),
  service: z.object({ start: clockTime, end: clockTime }),
});
