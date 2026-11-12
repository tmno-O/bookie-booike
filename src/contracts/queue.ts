import { z } from "zod";
import { id } from "./common";

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
