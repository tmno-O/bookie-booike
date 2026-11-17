import type { ISql } from "postgres";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { getVenue } from "./venue";

/**
 * `seatsLeft` is the zone's unbooked seats that night. For party buckets up to 12, `tablesLeft` is how many
 * more groups of this size still fit; for 12+ it is the number of free tables staff can join.
 */
type ZoneAvailability = { id: string; name: string; seatsLeft: number; tablesLeft: number; available: boolean; closed: boolean };

/** Parties above one table's 12 seats are checked across the free tables of each zone. */
function largePartyZones(sql: ISql, venueId: string, serviceDate: string, partySize: number, skipRelease: boolean) {
  return sql<ZoneAvailability[]>`
    select z.id, z.name, z.status = 'closed' as closed,
      greatest(0, zone_seats_left(z.venue_id, ${serviceDate}, z.id)) as seats_left,
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
  // Same rule as process_booking_request(): an open table carries the night's rules, the zone's seats decide.
  return sql<ZoneAvailability[]>`
    with rules as (
      select c.zone_id, count(*) filter (where c.result_code is null) as open_tables
      from booking_candidates_for(${venueId}, ${serviceDate}, null, null, 1, null, now(), ${skipRelease}) c
      group by c.zone_id
    ), zone_seats as (
      select z.*, greatest(0, zone_seats_left(z.venue_id, ${serviceDate}, z.id)) as seats_left
      from zones z where z.venue_id = ${venueId}
    )
    select z.id, z.name, z.status = 'closed' as closed, z.seats_left,
      case when coalesce(r.open_tables, 0) > 0 then z.seats_left / ${partySize}::int else 0 end as tables_left,
      z.status = 'active' and coalesce(r.open_tables, 0) > 0 and (
        z.seats_left >= ${partySize}::int or (${allowPending} and s.allocation_mode = 'manual')
      ) is true as available
    from zone_seats z left join rules r on r.zone_id = z.id
    left join venue_settings s on s.venue_id = z.venue_id
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
