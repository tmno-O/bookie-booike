import type { ISql, TransactionSql } from "postgres";
import type { z } from "zod";
import type { zonePatch } from "@/contracts/venue";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { bangkokDate } from "@/lib/service-date";
import { staffAudit } from "./audit";
import { zoneUsage } from "./inventory";
import { columns, staffChange } from "./venue";

function zoneView(row: Awaited<ReturnType<typeof zoneUsage>>[number]) {
  return { ...row, capacity: row.seats, bookedSeats: row.booked };
}

export async function listZones(venueId: string, serviceDate: string) {
  return { serviceDate, zones: (await zoneUsage(db(), venueId, serviceDate)).map(zoneView) };
}

async function readZone(sql: ISql, venueId: string, zoneId: string, today: string) {
  const [row] = await zoneUsage(sql, venueId, today, zoneId);
  return row ? zoneView(row) : notFound("Zone");
}

export function getZone(venueId: string, zoneId: string) {
  return readZone(db(), venueId, zoneId, bangkokDate());
}

async function assertCapacityCovers(
  tx: TransactionSql, venueId: string, zoneId: string, today: string, seats: number, managed: boolean,
) {
  const [usage] = await tx<{ maxSeats: number; tables: number; maxParty: number }[]>`
    with upcoming as (
      select service_date, table_id, party_size from bookings where venue_id = ${venueId} and zone_id = ${zoneId}
        and service_date >= ${today} and status in ('confirmed', 'checked_in')
    )
    select coalesce((select max(n.seats) from (select sum(party_size) as seats from upcoming group by service_date) n), 0)::int as max_seats,
      count(distinct table_id)::int as tables, coalesce(max(party_size), 0) as max_party
    from upcoming
  `;
  if (usage.maxSeats > seats || (managed && (usage.tables > Math.ceil(seats / 12) || usage.maxParty > 12))) {
    throw new ApiError(409, "CAPACITY_BELOW_BOOKED", "ความจุหรือจำนวนโต๊ะน้อยกว่าที่จองไว้แล้ว");
  }
}

async function syncTables(tx: TransactionSql, venueId: string, zoneId: string, today: string, seats: number) {
  const target = Math.ceil(seats / 12);
  await tx`
    with kept as (
      select t.id from venue_tables t
      where t.venue_id = ${venueId} and t.zone_id = ${zoneId}
      order by exists (
        select 1 from bookings b where b.venue_id = t.venue_id and b.zone_id = t.zone_id and b.table_id = t.id
          and b.service_date >= ${today} and b.status in ('confirmed', 'checked_in')
      ) desc, (t.status = 'active') desc, t.id limit ${target}
    )
    update venue_tables t set
      status = case when t.id in (select id from kept) then 'active' else 'closed' end,
      capacity = case when t.id in (select id from kept) then 12 else t.capacity end
    where t.venue_id = ${venueId} and t.zone_id = ${zoneId}
  `;
  await tx`
    with table_count as (
      select count(*)::int as total from venue_tables where venue_id = ${venueId} and zone_id = ${zoneId}
    )
    insert into venue_tables (venue_id, zone_id, name, capacity)
    select ${venueId}, ${zoneId}, 'โต๊ะ ' || n, 12
    from table_count cross join lateral generate_series(table_count.total + 1, ${target}) as n
  `;
}

export function changeZone(staff: Staff, patch: z.infer<typeof zonePatch>, zoneId?: string) {
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  const { venueId } = staff;
  const today = bangkokDate();
  return staffChange(staff, async (tx) => {
    const current = zoneId ? await readZone(tx, venueId, zoneId, today) : undefined;
    const { name, status, seats } = patch;
    const capacity = seats ?? patch.capacity;
    const managed = seats !== undefined || current?.seatManaged === true;
    if (name && name !== current?.name) {
      const [existing] = await tx`
        select id from zones where venue_id = ${venueId} and lower(name) = lower(${name})
          and id is distinct from ${zoneId ?? null}::uuid
      `;
      if (existing) throw new ApiError(409, "ZONE_NAME_TAKEN", "มีโซนชื่อนี้อยู่แล้ว");
    }
    if (zoneId && capacity !== undefined) await assertCapacityCovers(tx, venueId, zoneId, today, capacity, managed);

    const fields = columns({
      ...(name !== undefined && { name }),
      ...(status !== undefined && { status: status === "open" ? "active" : status }),
      ...(capacity !== undefined && { capacity, seatManaged: managed }),
    });
    const [row] = zoneId
      ? await tx<{ id: string }[]>`update zones set ${tx(fields)} where venue_id = ${venueId} and id = ${zoneId} returning id`
      : await tx<{ id: string }[]>`insert into zones ${tx({ ...fields, venue_id: venueId })} returning id`;
    if (managed && capacity !== undefined) await syncTables(tx, venueId, row.id, today, capacity);
    await staffAudit(tx, staff, zoneId ? "zone.updated" : "zone.created", row.id);
    return readZone(tx, venueId, row.id, today);
  });
}
