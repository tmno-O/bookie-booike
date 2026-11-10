import { z } from "zod";
import { PARTIES } from "./db";

export const customerInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^0\d{8,9}$/, "Phone must be 9–10 digits starting with 0"),
});
export const bookingInput = z.strictObject({
  requestId: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  party: z.enum(PARTIES),
  zoneId: z.string().min(1).max(100),
});
export const resetInput = z.strictObject({
  opensInSeconds: z.number().int().min(0).max(86400).optional(),
  queueStepSeconds: z.number().min(0).max(60).optional(),
});

export const staffBookingInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^0\d{8,9}$/, "Phone must be 9–10 digits starting with 0"),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  party: z.enum(PARTIES),
  zoneId: z.string().min(1).max(100),
});

export const zoneInput = z.strictObject({
  name: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1).max(1000),
  status: z.enum(["open", "closed"]),
});
export const zonePatch = zoneInput.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const standardHoursInput = z.strictObject({ daysBefore: z.number().int().min(0).max(30), time: clock });
export const specialDayInput = z.strictObject({ serviceDate: dateOnly, opensOn: dateOnly, time: clock })
  .refine((d) => d.opensOn <= d.serviceDate, { message: "opensOn must not be after the night", path: ["opensOn"] });

export const profileInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().regex(/^[0-9 +()-]{6,20}$/, "Phone may contain digits, spaces, + ( ) -").or(z.literal("")),
  address: z.string().trim().max(200),
  entryPolicy: z.string().trim().max(300),
});
export const inviteInput = z.strictObject({
  email: z.string().trim().toLowerCase().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email"),
  role: z.literal("staff"),
});
