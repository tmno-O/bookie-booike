import type { z } from "zod";
import type { closureInput, specialHours, standardHours } from "@/contracts/hours";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { bangkokDate } from "@/lib/service-date";
import { staffAudit } from "./audit";
import { changeRule, staffChange } from "./venue";

type Standard = z.infer<typeof standardHours>;
type Special = z.infer<typeof specialHours>;

export function getBookingHours(venueId: string) {
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const [standard] = await tx<Standard[]>`
      select coalesce(s.release_days_before, 365) as days_before, coalesce(left(s.release_time::text, 5), '00:00') as time
      from venues v left join venue_settings s on s.venue_id = v.id where v.id = ${venueId}
    `;
    const specials = await tx<(Special & { id: string; opensAt: Date })[]>`
      select to_char(r.service_date, 'YYYY-MM-DD') as id, to_char(r.service_date, 'YYYY-MM-DD') as service_date,
        to_char(opens_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as opens_on,
        to_char(opens_at at time zone 'Asia/Bangkok', 'HH24:MI') as time, opens_at
      from booking_releases r where venue_id = ${venueId} order by r.service_date
    `;
    const [rule] = await tx<{ openWeekdays: number[] }[]>`
      select coalesce(open_weekdays, array[0,1,2,3,4,5,6]::smallint[]) as open_weekdays
      from booking_rules where venue_id = ${venueId} and scope = 'venue' order by version desc limit 1
    `;
    const closures = await closureRows(tx, venueId);
    return { standard, specials, openWeekdays: rule?.openWeekdays ?? [0,1,2,3,4,5,6], closures, canEdit: true };
  });
}

async function closureRows(tx: import("postgres").ISql, venueId: string) {
  return tx`
    select to_char(c.service_date, 'YYYY-MM-DD') as service_date, c.reason,
      (select count(*)::int from bookings b where b.venue_id = c.venue_id and b.service_date = c.service_date
        and b.status in ('pending_allocation', 'confirmed', 'checked_in')) as affected_bookings
    from venue_closures c where c.venue_id = ${venueId} order by c.service_date
  `;
}

export function listClosures(venueId: string) { return closureRows(db(), venueId); }
export async function closureImpact(venueId: string, date: string) {
  const [row] = await db()`select count(*)::int as affected_bookings from bookings
    where venue_id = ${venueId} and service_date = ${date} and status in ('pending_allocation', 'confirmed', 'checked_in')`;
  return row;
}
export function saveOpenWeekdays(staff: Staff, openWeekdays: number[]) {
  return changeRule(staff, { scope: "venue", openWeekdays, closed: false });
}
export function addClosure(staff: Staff, closure: z.infer<typeof closureInput>) {
  return staffChange(staff, async (tx) => {
    if (closure.serviceDate < bangkokDate()) throw new ApiError(422, "DATE_IN_PAST", "คืนที่เลือกผ่านมาแล้ว");
    const [row] = await tx`
      insert into venue_closures (venue_id, service_date, reason, created_by)
      values (${staff.venueId}, ${closure.serviceDate}, ${closure.reason}, ${staff.userId})
      on conflict (venue_id, service_date) do nothing returning service_date
    `;
    if (!row) throw new ApiError(409, "CLOSURE_EXISTS", "คืนนี้ปิดพิเศษอยู่แล้ว");
    await staffAudit(tx, staff, "hours.closure_added", staff.venueId, closure);
    return { closure: (await closureRows(tx, staff.venueId)).find((c) => c.serviceDate === closure.serviceDate) };
  });
}
export function removeClosure(staff: Staff, serviceDate: string) {
  return staffChange(staff, async (tx) => {
    const [row] = await tx`delete from venue_closures where venue_id = ${staff.venueId} and service_date = ${serviceDate} returning reason`;
    if (!row) notFound("Closure");
    await staffAudit(tx, staff, "hours.closure_removed", staff.venueId, { serviceDate, reason: row.reason });
    return { ok: true };
  });
}

export function saveStandardHours(staff: Staff, standard: Standard) {
  return staffChange(staff, async (tx) => {
    await tx`
      insert into venue_settings (venue_id, release_days_before, release_time)
      values (${staff.venueId}, ${standard.daysBefore}, ${standard.time}::time)
      on conflict (venue_id) do update set
        release_days_before = excluded.release_days_before, release_time = excluded.release_time
    `;
    await staffAudit(tx, staff, "hours.standard_saved", staff.venueId);
    return { standard };
  });
}

export function addSpecialHours(staff: Staff, special: Special) {
  return staffChange(staff, async (tx) => {
    if (special.serviceDate < bangkokDate()) throw new ApiError(422, "DATE_IN_PAST", "คืนที่เลือกผ่านมาแล้ว");
    const [row] = await tx<{ opensAt: Date }[]>`
      insert into booking_releases (venue_id, service_date, opens_at)
      values (${staff.venueId}, ${special.serviceDate}, (${special.opensOn}::date + ${special.time}::time) at time zone 'Asia/Bangkok')
      on conflict (venue_id, service_date) do nothing returning opens_at
    `;
    if (!row) throw new ApiError(409, "SPECIAL_DAY_EXISTS", "คืนนี้มีการตั้งเวลาเฉพาะอยู่แล้ว");
    await staffAudit(tx, staff, "hours.special_added", staff.venueId);
    return { special: { ...special, id: special.serviceDate, opensAt: row.opensAt } };
  });
}

export function deleteSpecialHours(staff: Staff, serviceDate: string) {
  return staffChange(staff, async (tx) => {
    const [removed] = await tx`
      delete from booking_releases where venue_id = ${staff.venueId} and service_date = ${serviceDate}
      returning service_date
    `;
    if (!removed) notFound("Special opening day");
    await staffAudit(tx, staff, "hours.special_removed", staff.venueId);
    return { ok: true };
  });
}
