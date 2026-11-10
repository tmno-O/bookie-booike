import { z } from "zod";

export const id = z.uuid().transform((value) => value.toLowerCase());
export const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const serviceDate = z.iso.date();
export const instant = z.iso.datetime({ offset: true });
export const clockTime = z.iso.time({ precision: -1 });
export const label = z.string().trim().min(1).max(120);
export const selectionMode = z.enum(["customer_picks", "auto_assign"]);
export const status = z.enum(["active", "closed"]);
export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
