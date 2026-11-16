import type { ISql } from "postgres";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getVenue } from "./venue";

type ZoneAvailability = { id: string; name: string; tablesLeft: number; available: boolean; closed: boolean };

/** Parties above one table's 12 seats are checked across the free tables of each zone. */
function largePartyZones(sql: ISql, venueId: string, serviceDate: string, partySize: number, skipRelease: boolean) {
  return sql<ZoneAvailability[]>`
    select z.id, z.name, z.status = 'closed' as closed,
      (select count(*)::int from booking_candidates_for(${venueId}, ${serviceDate}, null, z.id, 1, null, now(), ${skipRelease}) c
        where c.result_code is null and not exists (select 1 from booking_allocations a
          where a.table_id = c.id and a.service_date = ${serviceDate} and a.active)) as tables_left,
      z.status = 'active' and coalesce(s.large_party_mode, 'staff_review') = 'staff_review'
        and zone_fits_party(${venueId}, ${serviceDate}, z.id, ${partySize}, now(), ${skipRelease}) is null as available
    from zones z left join venue_settings s on s.venue_id = z.venue_id
    where z.venue_id = ${venueId}
    order by z.name, z.id
  `;
}

export function zoneAvailability(
  sql: ISql, venueId: string, serviceDate: string, partySize: number,
  { skipRelease = false, allowPending = false } = {},
) {
  if (partySize > 12) return largePartyZones(sql, venueId, serviceDate, partySize, skipRelease);
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
    const [night] = await tx<{ opensAt: Date; issue: string | null }[]>`
      select opens_at_for(${venueId}, ${serviceDate}) as opens_at,
        booking_window_issue(${venueId}, ${serviceDate}, now()) as issue
    `;
    if (night.issue === "DATE_OUT_OF_RANGE") throw new ApiError(422, night.issue, "วันที่อยู่นอกช่วงเปิดจอง");
    const tables = await tx`select * from venue_availability(${venueId}, ${serviceDate})`;
    const zones = await zoneAvailability(tx, venueId, serviceDate, partySize, { allowPending: true });
    return { venueId, serviceDate, tables, zones, opensAt: night.opensAt,
      nightOpen: night.issue === null, closed: night.issue === "CLOSED" || night.issue === "BOOKING_CLOSED" };
  });
}
