import postgres from "postgres";
import type { z } from "zod";
import {
  lineIntegrationPatch, profilePatch, releaseInput, ruleInput, settingsPatch,
} from "@/contracts/venue";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { encryptSecret } from "@/lib/crypto";
import type { Staff } from "@/lib/auth/staff-auth";
import { staffAudit } from "./audit";

export function staffChange<T>(
  staff: Staff,
  change: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${staff.venueId}, 2))`;
    return change(tx);
  });
}

export function columns(value: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [postgres.fromCamel(key), field]));
}

export async function getVenue(lookup: { venueId: string } | { slug: string }) {
  const sql = db();
  const predicate = "venueId" in lookup ? sql`v.id = ${lookup.venueId}` : sql`v.slug = ${lookup.slug}`;
  const [venue] = await sql`
    select v.id, v.slug, v.name, v.description, v.contact, v.map_url, v.image_url, v.timezone,
           v.table_selection_mode, v.cancel_cutoff_minutes, l.liff_id
    from venues v left join venue_line_integrations l on l.venue_id = v.id
    where ${predicate}
  `;
  return venue ?? notFound("Venue");
}

export async function changeVenue(staff: Staff, patch: z.infer<typeof profilePatch> | z.infer<typeof settingsPatch>, action: string) {
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  await staffChange(staff, async (tx) => {
    await tx`update venues set ${tx(columns(patch))} where id = ${staff.venueId}`;
    await staffAudit(tx, staff, action, staff.venueId);
  });
  return getVenue(staff);
}

export async function releases(venueId: string) {
  await getVenue({ venueId });
  return db()`
    select to_char(service_date, 'YYYY-MM-DD') as service_date, opens_at, closes_at from booking_releases
    where venue_id = ${venueId} order by booking_releases.service_date
  `;
}

export async function saveRelease(staff: Staff, release: z.infer<typeof releaseInput>) {
  return staffChange(staff, async (tx) => {
    const [row] = await tx`
      insert into booking_releases (venue_id, service_date, opens_at, closes_at)
      values (${staff.venueId}, ${release.serviceDate}, ${release.opensAt}, ${release.closesAt})
      on conflict (venue_id, service_date) do update
        set opens_at = excluded.opens_at, closes_at = excluded.closes_at
      returning to_char(service_date, 'YYYY-MM-DD') as service_date, opens_at, closes_at
    `;
    await staffAudit(tx, staff, "release.saved", staff.venueId);
    return row;
  });
}

export async function rules(venueId: string) {
  return db()`
    select distinct on (scope, zone_id, table_id) id, scope, coalesce(zone_id, table_id) as scope_id,
      version, min_notice_minutes, max_advance_days, open_weekdays, closed, service_start, service_end
    from booking_rules where venue_id = ${venueId}
    order by scope, zone_id, table_id, version desc
  `;
}

export async function changeRule(staff: Staff, rule: z.infer<typeof ruleInput>) {
  return staffChange(staff, async (tx) => {
    const zoneId = rule.scope === "zone" ? rule.scopeId! : null;
    const tableId = rule.scope === "table" ? rule.scopeId! : null;
    if (zoneId) {
      const [zone] = await tx`select id from zones where venue_id = ${staff.venueId} and id = ${zoneId}`;
      if (!zone) notFound("Zone");
    }
    if (tableId) {
      const [table] = await tx`select id from venue_tables where venue_id = ${staff.venueId} and id = ${tableId}`;
      if (!table) notFound("Table");
    }

    const [previous] = await tx`
      select version, min_notice_minutes, max_advance_days, open_weekdays, closed, service_start, service_end
      from booking_rules where venue_id = ${staff.venueId} and scope = ${rule.scope}
        and zone_id is not distinct from ${zoneId}::uuid and table_id is not distinct from ${tableId}::uuid
      order by version desc limit 1
    `;
    const { scope, scopeId, ...patch } = rule;
    const { openWeekdays, ...fields } = { ...previous, ...patch, version: (previous?.version ?? 0) + 1 };
    const [row] = await tx`
      insert into booking_rules ${tx({
        ...columns(fields), open_weekdays: openWeekdays == null ? null : tx.array(openWeekdays, 1005),
        venue_id: staff.venueId, scope, zone_id: zoneId, table_id: tableId,
      })}
      returning id, scope, coalesce(zone_id, table_id) as scope_id, version,
        min_notice_minutes, max_advance_days, open_weekdays, closed, service_start, service_end
    `;
    await staffAudit(tx, staff, "rule.version_added", scopeId ?? staff.venueId);
    return row;
  });
}

export async function lineIntegration(venueId: string) {
  const [row] = await db()`
    select provider_id, channel_id, liff_id, channel_secret_ciphertext is not null as has_channel_secret,
      access_token_ciphertext is not null as has_access_token
    from venue_line_integrations where venue_id = ${venueId}
  `;
  return row ?? null;
}

export async function saveLineIntegration(staff: Staff, patch: z.infer<typeof lineIntegrationPatch>) {
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  await staffChange(staff, async (tx) => {
    const [old] = await tx`
      select provider_id, channel_id, liff_id, channel_secret_ciphertext, access_token_ciphertext
      from venue_line_integrations where venue_id = ${staff.venueId}
    `;
    const providerId = patch.providerId ?? old?.providerId;
    const channelId = patch.channelId ?? old?.channelId;
    const liffId = patch.liffId ?? old?.liffId;
    if (!providerId || !channelId || !liffId) {
      throw new ApiError(400, "LINE_CONFIG_INCOMPLETE", "Provider, channel and LIFF IDs are required");
    }
    const channelChanged = old && (old.providerId !== providerId || old.channelId !== channelId);
    const secret = patch.channelSecret === undefined
      ? (channelChanged ? null : old?.channelSecretCiphertext ?? null)
      : patch.channelSecret && encryptSecret(patch.channelSecret, `${staff.venueId}:channel-secret`);
    const token = patch.channelAccessToken === undefined
      ? (channelChanged ? null : old?.accessTokenCiphertext ?? null)
      : patch.channelAccessToken && encryptSecret(patch.channelAccessToken, `${staff.venueId}:access-token`);

    await tx`
      insert into venue_line_integrations
        (venue_id, provider_id, channel_id, liff_id, channel_secret_ciphertext, access_token_ciphertext)
      values (${staff.venueId}, ${providerId}, ${channelId}, ${liffId}, ${secret}, ${token})
      on conflict (venue_id) do update set provider_id = excluded.provider_id, channel_id = excluded.channel_id,
        liff_id = excluded.liff_id, channel_secret_ciphertext = excluded.channel_secret_ciphertext,
        access_token_ciphertext = excluded.access_token_ciphertext
    `;
    if (channelChanged) await tx`delete from customer_sessions where venue_id = ${staff.venueId}`;
    await staffAudit(tx, staff, "line.integration_updated", staff.venueId);
  });
  return lineIntegration(staff.venueId);
}
