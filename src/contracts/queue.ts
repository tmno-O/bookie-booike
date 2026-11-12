import { z } from "zod";
import { id, instant, serviceDate } from "./common";
import { partyBucket } from "./party";

export const contactInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(/^0\d{8,9}$/),
});

export const queueTicket = z.object({
  requestId: id,
  status: z.enum(["waiting", "ready", "used", "expired"]),
  position: z.number().int().nonnegative(),
  ready: z.boolean(),
  bookingId: id.nullable(),
  bookingRequestId: id.nullable(),
});

const staffQueueStatus = z.enum(["pending", "allocated"]);
export const staffQueueQuery = z.object({
  date: serviceDate.optional(),
  status: z.union([staffQueueStatus, z.literal("all")]).default("all"),
});
export const staffQueueRow = z.object({
  id, queueNo: z.number().int().positive(), requestedAt: instant, name: z.string(), serviceDate,
  party: partyBucket, zoneId: id, zoneName: z.string(), status: staffQueueStatus,
});
export const allocationInput = z.strictObject({ zoneId: id.optional() });
