import { z } from "zod";
import { id, instant, serviceDate, slug } from "./common";

export const lineSessionInput = z.strictObject({ venueSlug: slug, idToken: z.string().min(1).max(8192) });
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);

const bookingFields = {
  serviceDate,
  serviceAt: instant.optional(),
  partySize: z.number().int().min(1).max(1000),
  contactPhone: z.string().trim().regex(/^\+?[0-9]{8,15}$/).optional(),
  tableId: id.optional(),
  zoneId: id.optional(),
};

function validateTarget(value: { tableId?: string; zoneId?: string }) {
  return Boolean(value.tableId) !== Boolean(value.zoneId);
}

export const customerBookingInput = z.strictObject({
  venueId: id,
  ...bookingFields,
}).refine(validateTarget, "Specify either tableId or zoneId");

export const staffBookingInput = z.strictObject({
  customerId: id,
  ...bookingFields,
}).refine(validateTarget, "Specify either tableId or zoneId");

export const requestAccepted = z.object({ requestId: id });
export const requestStatus = z.object({
  requestId: id,
  status: z.enum(["pending_publish", "queued", "confirmed", "rejected"]),
  resultCode: z.string().nullable(),
  bookingId: id.nullable(),
});
export const booking = z.object({
  id, venueId: id, customerId: id, tableId: id, zoneId: id,
  serviceDate, serviceAt: instant, partySize: z.number().int().positive(),
  status: z.enum(["confirmed", "cancelled"]),
  createdAt: instant, cancelledAt: instant.nullable(),
});
export const cancellationInput = z.strictObject({ status: z.literal("cancelled") });
export type BookingInput = z.infer<typeof customerBookingInput>;
