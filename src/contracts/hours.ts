import { z } from "zod";
import { clockTime, instant, serviceDate } from "./common";

export const standardHours = z.strictObject({ daysBefore: z.number().int().min(0).max(365), time: clockTime });
export const specialHours = z.strictObject({ serviceDate, opensOn: serviceDate, time: clockTime })
  .refine((value) => value.opensOn <= value.serviceDate, "วันเปิดรับจองต้องไม่เกินคืนที่จอง");
export const hoursData = z.object({
  standard: standardHours,
  specials: z.array(z.object({ id: serviceDate, serviceDate, opensOn: serviceDate, time: clockTime, opensAt: instant })),
  canEdit: z.literal(true),
});
