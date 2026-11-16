import type { z } from "zod";
import type { closureInput, serviceHoursInput, specialHours, standardHours } from "@/contracts/hours";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { bangkokDate } from "@/lib/service-date";
import { staffAudit } from "./audit";
import { fanoutAnnouncement } from "./announcements";
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
        to_char(opens_at at time zone 'Asia/Bangkok', 'HH24:MI') as time, opens_at, coalesce(r.title, '') as title,
        (select count(*)::int from announcement_outbox o join release_announcements a on a.id = o.announcement_id
          where a.venue_id = r.venue_id and a.service_date = r.service_date and a.opens_at = r.opens_at) as recipients,
        (select count(*)::int from announcement_outbox o join release_announcements a on a.id = o.announcement_id
          where a.venue_id = r.venue_id and a.service_date = r.service_date and a.opens_at = r.opens_at and o.status = 'sent') as sent,
        (select count(*)::int from announcement_outbox o join release_announcements a on a.id = o.announcement_id
          where a.venue_id = r.venue_id and a.service_date = r.service_date and a.opens_at = r.opens_at and o.status = 'dead') as failed
      from booking_releases r where venue_id = ${venueId} order by r.service_date
    `;
    const [rule] = await tx<{ openWeekdays: number[]; start: string | null; end: string | null }[]>`
      select coalesce(open_weekdays, array[0,1,2,3,4,5,6]::smallint[]) as open_weekdays,
        left(service_start::text, 5) as start, left(service_end::text, 5) as "end"
      from booking_rules where venue_id = ${venueId} and scope = 'venue' order by version desc limit 1
    `;
    const closures = await closureRows(tx, venueId);
    return {
      standard, specials, openWeekdays: rule?.openWeekdays ?? [0,1,2,3,4,5,6], closures, canEdit: true,
      // Same defaults as effective_rule() when the venue has not set its own service window.
      service: { start: rule?.start ?? "18:00", end: rule?.end ?? "02:00" },
    };
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
/** Saves the weekly opening days and reports upcoming bookings that now fall on a closed weekday. */
export async function saveOpenWeekdays(staff: Staff, openWeekdays: number[]) {
  await changeRule(staff, { scope: "venue", openWeekdays, closed: false });
  const sql = db();
  const [row] = await sql<{ affectedBookings: number }[]>`
    select count(*)::int as affected_bookings from bookings
    where venue_id = ${staff.venueId} and service_date >= ${bangkokDate()}::date
      and status in ('pending_allocation', 'confirmed')
      and not (extract(dow from service_date)::int = any(${sql.array(openWeekdays, 23)}))
  `;
  return { openWeekdays, affectedBookings: row.affectedBookings };
}
export function saveServiceHours(staff: Staff, hours: z.infer<typeof serviceHoursInput>) {
  return changeRule(staff, { scope: "venue", ...hours, closed: false });
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
    // The venue lock is held, so no booking for this night can be decided between this count and the cancellations.
    const active = await tx<{ id: string }[]>`
      select id from bookings where venue_id = ${staff.venueId} and service_date = ${closure.serviceDate}
        and status in ('pending_allocation', 'confirmed') order by created_at, id
    `;
    if (active.length && !closure.bookings) {
      throw new ApiError(409, "CLOSURE_HAS_BOOKINGS", `คืนนี้มีการจอง ${active.length} รายการ เลือกว่าจะคงไว้หรือยกเลิกพร้อมแจ้งลูกค้า`);
    }
    let cancelled = 0;
    if (closure.bookings === "cancel") {
      const note = closure.reason ? `ร้านปิดคืนนี้: ${closure.reason}` : "ร้านปิดในคืนที่จอง";
      for (const booking of active) {
        const [result] = await tx<{ code: string }[]>`select cancel_booking(${staff.venueId}, ${booking.id}, 'staff', ${staff.userId}) as code`;
        if (result.code !== "CANCELLED") continue;
        await tx`update notification_outbox set note = ${note} where booking_id = ${booking.id} and kind = 'cancelled'`;
        cancelled++;
      }
    }
    await staffAudit(tx, staff, "hours.closure_added", staff.venueId,
      { ...closure, service_date: closure.serviceDate, activeBookings: active.length, cancelledBookings: cancelled });
    return { closure: (await closureRows(tx, staff.venueId)).find((c) => c.serviceDate === closure.serviceDate), cancelledBookings: cancelled };
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

export async function addSpecialHours(staff: Staff, special: Special) {
  const saved = await staffChange(staff, async (tx) => {
    if (special.serviceDate < bangkokDate()) throw new ApiError(422, "DATE_IN_PAST", "คืนที่เลือกผ่านมาแล้ว");
    const [night] = await tx`select service_night_open(${staff.venueId}, ${special.serviceDate}) as open`;
    if (!night.open) throw new ApiError(409, "CLOSED", "ร้านปิดในคืนที่เลือก");
    const [row] = await tx<{ opensAt: Date }[]>`
      insert into booking_releases (venue_id, service_date, opens_at, title)
      values (${staff.venueId}, ${special.serviceDate}, (${special.opensOn}::date + ${special.time}::time) at time zone 'Asia/Bangkok', ${special.title})
      on conflict (venue_id, service_date) do nothing returning opens_at
    `;
    if (!row) throw new ApiError(409, "SPECIAL_DAY_EXISTS", "คืนนี้มีการตั้งเวลาเฉพาะอยู่แล้ว");
    const [announcement] = special.announce
      ? await tx<{ id: string }[]>`select announce_release(${staff.venueId}, ${special.serviceDate}, ${special.title}, ${row.opensAt}, ${staff.userId}) as id`
      : [];
    await staffAudit(tx, staff, "hours.special_added", staff.venueId, special);
    return { announcementId: announcement?.id ?? null, special: { ...special, id: special.serviceDate, opensAt: row.opensAt } };
  });
  // Outside the venue lock: bookings keep flowing while the audience is queued.
  if (saved.announcementId) await fanoutAnnouncement(saved.announcementId);
  return { special: saved.special };
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
