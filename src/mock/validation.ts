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
