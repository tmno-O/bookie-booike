import { z } from "zod";
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
  name: label,
  description: z.string().trim().max(2000).nullable(),
  contact: z.string().trim().max(250).nullable(),
  mapUrl: httpsUrl.nullable(),
  imageUrl: httpsUrl.nullable(),
  timezone: z.string().refine(ianaZone),
}).partial();
export const settingsPatch = z.strictObject({
  tableSelectionMode: selectionMode.optional(),
  cancelCutoffMinutes: z.number().int().min(0).max(525600).optional(),
});
const zoneFields = z.strictObject({ name: label, capacity, status });
export const zoneInput = zoneFields.extend({ status: status.default("active") });
export const zonePatch = zoneFields.partial();
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
  liffId: z.string().nullable(),
});
export const availability = z.object({
  venueId: id, serviceDate,
  tables: z.array(z.object({
    id, zoneId: id, zoneName: label, name: label, capacity, priceSatang: z.number().int().nullable(),
    available: z.boolean(), resultCode: z.string().nullable(), startsAt: instant, endsAt: instant,
  })),
});
