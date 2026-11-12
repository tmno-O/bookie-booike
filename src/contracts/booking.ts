import { z } from "zod";
import { id, instant, serviceDate, slug } from "./common";
import { partyBucket } from "./party";

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

const legacyBookingInput = z.strictObject({
  venueId: id,
  ...bookingFields,
}).refine(validateTarget, "Specify either tableId or zoneId");

export const ticketBookingInput = z.strictObject({ venueId: id, ticketId: id, zoneId: id, serviceDate, partyBucket });
export const customerBookingInput = z.union([ticketBookingInput, legacyBookingInput]);

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
export const bookingStatus = z.enum(["confirmed", "pending_allocation", "checked_in", "cancelled"]);
export const booking = z.object({
  id, venueId: id, customerId: id, tableId: id.nullable(), zoneId: id,
  serviceDate, serviceAt: instant, partySize: z.number().int().positive(),
  status: bookingStatus,
  createdAt: instant, cancelledAt: instant.nullable(), checkedInAt: instant.nullable(),
  reference: z.string().regex(/^BL-\d{4}-\d{4,}$/),
  name: z.string(), phone: z.string(), zoneName: z.string(), party: partyBucket,
  source: z.enum(["liff", "staff_assisted"]),
});
export const cancellationInput = z.strictObject({ status: z.literal("cancelled") });
export type BookingInput = z.infer<typeof legacyBookingInput>;
