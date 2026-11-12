import { z } from "zod";
import { booking, bookingStatus } from "./booking";
import { id, serviceDate, slug } from "./common";

export const staffLoginInput = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
  venueSlug: slug.optional(),
});

export const staffRole = z.enum(["owner", "staff"]);
export const staffProfile = z.object({
  staff: z.object({ email: z.email(), displayName: z.string(), role: staffRole }),
  venue: z.object({ id, slug, name: z.string() }),
});

export const dashboardQuery = z.object({ date: serviceDate.optional() });
export const bookingListQuery = dashboardQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
  status: z.union([bookingStatus, z.literal("pending")]).optional(),
  zone: id.optional(),
  q: z.string().trim().max(80).optional(),
});

const count = z.number().int().nonnegative();
export const dashboardData = z.object({
  serviceDate, today: serviceDate,
  metrics: z.object({ bookings: count, guests: count, pendingRequests: count, checkedIn: count }),
  bookings: z.array(booking),
  zones: z.array(z.object({ id, name: z.string(), status: z.enum(["active", "closed"]), seats: count, booked: count })),
});
