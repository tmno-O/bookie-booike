import type { ISql } from "postgres";
import { db } from "@/lib/db";
import { getVenue } from "./venue";

export function zoneAvailability(
  sql: ISql, venueId: string, serviceDate: string, partySize: number,
  { skipRelease = false, allowPending = false } = {},
) {
  return sql<{ id: string; name: string; tablesLeft: number; available: boolean; closed: boolean }[]>`
    with candidates as (
      select c.zone_id, c.result_code,
        c.result_code is null and has_booking_capacity(
          ${venueId}, ${serviceDate}, c.id, c.zone_id, c.zone_capacity, ${partySize}
        ) as free
      from booking_candidates_for(${venueId}, ${serviceDate}, null, null, ${partySize}, null, now(), ${skipRelease}) c
    )
    select z.id, z.name, z.status = 'closed' as closed, count(c.free) filter (where c.free)::int as tables_left,
      z.status = 'active' and (
        count(c.free) filter (where c.free) > 0
        or (${allowPending} and s.allocation_mode = 'manual' and count(c.zone_id) filter (where c.result_code is null) > 0)
      ) is true as available
    from zones z left join candidates c on c.zone_id = z.id
    left join venue_settings s on s.venue_id = z.venue_id
    where z.venue_id = ${venueId}
    group by z.id, s.allocation_mode
    order by z.name, z.id
  `;
}

export async function venueAvailability(venueId: string, serviceDate: string, partySize = 1) {
  await getVenue({ venueId });
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const tables = await tx`select * from venue_availability(${venueId}, ${serviceDate})`;
    const zones = await zoneAvailability(tx, venueId, serviceDate, partySize, { allowPending: true });
    const [night] = await tx`
      select s.opens_at, s.opens_at <= now() and (closes_at is null or closes_at > now()) as night_open
      from (select opens_at_for(${venueId}, ${serviceDate}) as opens_at) s
      left join booking_releases b on b.venue_id = ${venueId} and b.service_date = ${serviceDate}
    `;
    return { venueId, serviceDate, tables, zones, ...night };
  });
}
