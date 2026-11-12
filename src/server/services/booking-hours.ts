import type { z } from "zod";
import type { specialHours, standardHours } from "@/contracts/hours";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { bangkokDate } from "@/lib/service-date";
import { staffAudit } from "./audit";
import { staffChange } from "./venue";

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
    return { standard, specials, canEdit: true };
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
