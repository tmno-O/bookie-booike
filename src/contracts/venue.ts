import { z } from "zod";
import { partyBucket } from "./party";
import { clockTime, id, instant, label, selectionMode, serviceDate, slug, status } from "./common";

function ianaZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return !/^[+-]/.test(value);
  } catch {
    return false;
  }
}

const httpsUrl = z.url({ protocol: /^https$/ });
const capacity = z.number().int().min(1).max(1000);
export const profilePatch = z.strictObject({
  slug,
  name: label,
  description: z.string().trim().max(2000).nullable(),
  contact: z.string().trim().max(250).nullable(),
  mapUrl: httpsUrl.nullable(),
  imageUrl: httpsUrl.nullable(),
  timezone: z.string().refine(ianaZone),
}).partial();
export const venueSlugPatch = profilePatch.pick({ slug: true }).required();
export const shopProfileInput = z.strictObject({
  name: label,
  phone: z.string().trim().regex(/^(?:[0-9 +()-]{6,20})?$/),
  address: z.string().trim().max(200),
  entryPolicy: z.string().trim().max(300),
});
export const DEFAULT_REMINDER_HOURS = 24;
export const MAX_REMINDER_HOURS = 365 * 24;
const reminderHours = z.number().int().min(1).max(MAX_REMINDER_HOURS).nullable();
export const lineReminderSettings = z.strictObject({
  bookingReminderHours: reminderHours,
  specialReminderHours: reminderHours,
});
export type LineReminderSettings = z.infer<typeof lineReminderSettings>;

export const settingsPatch = z.strictObject({
  tableSelectionMode: selectionMode.optional(),
  allocationMode: z.enum(["auto", "manual"]).optional(),
  cancelCutoffMinutes: z.number().int().min(0).max(525600).optional(),
  customerCancelEnabled: z.boolean().optional(),
  largePartyMode: z.enum(["staff_review", "disabled"]).optional(),
  ...lineReminderSettings.partial().shape,
});
const zoneStatus = z.enum(["active", "open", "closed"]);
const legacyZone = z.strictObject({ name: label, capacity, status: status.default("active") });
const seatsZone = z.strictObject({ name: label, seats: capacity, status: zoneStatus.default("active") });
export const zoneInput = z.union([seatsZone, legacyZone]);
export const zonePatch = z.strictObject({ name: label, capacity, seats: capacity, status: zoneStatus }).partial()
  .refine((zone) => zone.capacity === undefined || zone.seats === undefined, "Use either seats or capacity");
export const zonesQuery = z.object({ date: serviceDate.optional() });
export const zoneView = z.object({
  id, name: label, status, seats: capacity, tables: z.number().int().nonnegative(),
  tablesUsed: z.number().int().nonnegative(), bookedSeats: z.number().int().nonnegative(),
});
const tableFields = z.strictObject({
  zoneId: id, name: label, capacity,
  priceSatang: z.number().int().min(0).max(2147483647).nullable(),
  status,
});
export const tableInput = tableFields.extend({ priceSatang: tableFields.shape.priceSatang.default(null), status: status.default("active") });
export const tablePatch = tableFields.partial();
export const ruleInput = z.strictObject({
  scope: z.enum(["venue", "zone", "table"]),
  scopeId: id.optional(),
  minNoticeMinutes: z.number().int().min(0).max(525600).nullable().optional(),
  maxAdvanceDays: z.number().int().min(0).max(365).nullable().optional(),
  openWeekdays: z.array(z.number().int().min(0).max(6)).max(7)
    .refine((days) => new Set(days).size === days.length).nullable().optional(),
  closed: z.boolean().nullable().optional(),
  serviceStart: clockTime.nullable().optional(),
  serviceEnd: clockTime.nullable().optional(),
}).refine((rule) => (rule.scope === "venue") === !rule.scopeId, "Specify scopeId for zone or table rules");
export const releaseInput = z.strictObject({
  serviceDate, opensAt: instant, closesAt: instant.nullable().default(null),
}).refine((release) => !release.closesAt || Date.parse(release.closesAt) > Date.parse(release.opensAt));
export const lineIntegrationPatch = z.strictObject({
  providerId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  channelId: z.string().regex(/^\d{1,30}$/).optional(),
  liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/).optional(),
  channelSecret: z.string().min(1).max(512).nullable().optional(),
  channelAccessToken: z.string().min(1).max(4096).nullable().optional(),
});
export const venuePublic = z.object({
  id, slug, name: label, description: z.string().nullable(), contact: z.string().nullable(),
  mapUrl: z.string().nullable(), imageUrl: z.string().nullable(), timezone: z.string(),
  tableSelectionMode: selectionMode, cancelCutoffMinutes: z.number().int(),
  customerCancelEnabled: z.boolean().optional(),
  largePartyMode: z.enum(["staff_review", "disabled"]).optional(),
  liffId: z.string().nullable(),
  allocationMode: z.enum(["auto", "manual"]).optional(),
});
export const venueBookingProfile = venuePublic.extend({
  opensAt: instant.nullable(), open: z.boolean(), secondsUntilOpen: z.number().int().nonnegative(),
  openWeekdays: z.array(z.number().int().min(0).max(6)),
  closedDates: z.array(z.object({ serviceDate, reason: z.string() })),
  today: serviceDate, maxAdvanceDays: z.number().int().nonnegative(), openNights: z.array(serviceDate).optional(),
  upcomingNights: z.array(z.object({ serviceDate, opensAt: instant })).optional(),
  nextDateAt: instant.optional(),
  shop: z.object({ name: label, phone: z.string(), address: z.string(), entryPolicy: z.string() }),
});
export const availabilityQuery = z.object({ date: serviceDate, partyBucket: partyBucket.optional() });
export const availability = z.object({
  venueId: id, serviceDate,
  nightOpen: z.boolean().optional(),
  closed: z.boolean().optional(),
  opensAt: instant.optional(),
  zones: z.array(z.object({
    id, name: label, tablesLeft: z.number().int().nonnegative(), available: z.boolean(), closed: z.boolean(),
  })).optional(),
  tables: z.array(z.object({
    id, zoneId: id, zoneName: label, name: label, capacity, priceSatang: z.number().int().nullable(),
    available: z.boolean(), resultCode: z.string().nullable(), startsAt: instant, endsAt: instant,
  })),
});
