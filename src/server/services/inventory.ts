import type { ISql } from "postgres";
import type { z } from "zod";
import type { tablePatch } from "@/contracts/venue";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { staffAudit } from "./audit";
import { columns, staffChange } from "./venue";

export async function tables(venueId: string, tableId?: string) {
  const sql = db();
  const filter = tableId ? sql`and id = ${tableId}` : sql``;
  const rows = await sql`select * from venue_tables where venue_id = ${venueId} ${filter} order by name, id`;
  return tableId ? rows[0] ?? notFound("Table") : rows;
}

export function zoneUsage(sql: ISql, venueId: string, serviceDate: string, zoneId?: string) {
  return sql<{
    id: string; venueId: string; name: string; status: "active" | "closed"; seatManaged: boolean;
    seats: number; booked: number; tablesUsed: number; tables: number;
  }[]>`
    select z.id, z.venue_id, z.name, z.status, z.seat_managed, z.capacity as seats,
      coalesce(sum(b.party_size), 0)::int as booked,
      (select count(*)::int from booking_allocations a join venue_tables t on t.venue_id = a.venue_id and t.id = a.table_id
        where a.venue_id = z.venue_id and t.zone_id = z.id and a.service_date = ${serviceDate} and a.active) as tables_used,
      (select count(*)::int from venue_tables t where t.venue_id = z.venue_id and t.zone_id = z.id
        and t.status = 'active') as tables
    from zones z left join bookings b on b.venue_id = z.venue_id and b.zone_id = z.id
      and b.service_date = ${serviceDate} and b.status in ('confirmed', 'checked_in')
    where z.venue_id = ${venueId} ${zoneId ? sql`and z.id = ${zoneId}` : sql``}
    group by z.id order by z.name, z.id
  `;
}

export function changeTable(staff: Staff, patch: z.infer<typeof tablePatch>, tableId?: string) {
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  const { venueId } = staff;
  return staffChange(staff, async (tx) => {
    const [current] = tableId ? await tx<{ zoneId: string }[]>`
      select zone_id from venue_tables where venue_id = ${venueId} and id = ${tableId}` : [];
    if (tableId && !current) notFound("Table");
    const zoneId = patch.zoneId ?? current?.zoneId ?? notFound("Zone");
    const zones = await tx<{ id: string; seatManaged: boolean }[]>`
      select id, seat_managed from zones where venue_id = ${venueId} and id in ${tx([zoneId, current?.zoneId ?? zoneId])}
    `;
    if (!zones.some((zone) => zone.id === zoneId)) notFound("Zone");
    if (zones.some((zone) => zone.seatManaged)) {
      throw new ApiError(409, "ZONE_SEATS_MANAGED", "แก้จำนวนโต๊ะผ่านความจุของโซน");
    }
    const fields = columns(patch);
    const [row] = tableId
      ? await tx`update venue_tables set ${tx(fields)} where venue_id = ${venueId} and id = ${tableId} returning *`
      : await tx`insert into venue_tables ${tx({ ...fields, venue_id: venueId })} returning *`;
    await staffAudit(tx, staff, tableId ? "table.updated" : "table.created", row.id);
    return row;
  });
}
