import type { ISql } from "postgres";
import type { z } from "zod";
import { tablePatch, zonePatch } from "@/contracts/venue";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import type { Staff } from "@/lib/auth/staff-auth";
import { columns, staffChange } from "./venue";
import { staffAudit } from "./audit";

type Inventory = "zones" | "venue_tables";

export async function inventory(venueId: string, relation: Inventory, id?: string) {
  const sql = db();
  const filter = id ? sql`and id = ${id}` : sql``;
  const rows = await sql`
    select * from ${sql(relation)} where venue_id = ${venueId} ${filter} order by name, id
  `;
  return id ? rows[0] ?? notFound(relation === "zones" ? "Zone" : "Table") : rows;
}

export function zoneUsage(sql: ISql, venueId: string, serviceDate: string) {
  return sql<{ id: string; name: string; status: "active" | "closed"; seats: number; booked: number; tablesUsed: number }[]>`
    select z.id, z.name, z.status, z.capacity as seats, coalesce(sum(b.party_size), 0)::int as booked,
      count(b.id)::int as tables_used
    from zones z left join bookings b on b.venue_id = z.venue_id and b.zone_id = z.id
      and b.service_date = ${serviceDate} and b.status in ('confirmed', 'checked_in')
    where z.venue_id = ${venueId}
    group by z.id order by z.name, z.id
  `;
}

export async function changeInventory(
  staff: Staff, relation: Inventory, patch: z.infer<typeof tablePatch> | z.infer<typeof zonePatch>, id?: string,
) {
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  return staffChange(staff, async (tx) => {
    if ("zoneId" in patch && patch.zoneId) {
      const [zone] = await tx`select id from zones where venue_id = ${staff.venueId} and id = ${patch.zoneId}`;
      if (!zone) notFound("Zone");
    }
    const values = columns(patch);
    const [row] = id
      ? await tx`update ${tx(relation)} set ${tx(values)}
          where venue_id = ${staff.venueId} and id = ${id} returning *`
      : await tx`insert into ${tx(relation)} ${tx({ ...values, venue_id: staff.venueId })} returning *`;
    const kind = relation === "zones" ? "zone" : "table";
    if (!row) notFound(kind);
    await staffAudit(tx, staff, `${kind}.${id ? "updated" : "created"}`, row.id);
    return row;
  });
}
