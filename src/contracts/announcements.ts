import { z } from "zod";
import { id, instant, serviceDate } from "./common";

export const announcement = z.object({ id, title: z.string(), serviceDate, opensAt: instant, timezone: z.string() });
export const announcementsData = z.object({ announcements: z.array(announcement), optedOut: z.boolean() });
export const optOutInput = z.strictObject({ optOut: z.boolean() });
