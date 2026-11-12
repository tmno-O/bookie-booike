import { z } from "zod";
import { id, slug } from "./common";

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
