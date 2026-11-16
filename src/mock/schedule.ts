import { addDays, today, type Db } from "./db";

const BANGKOK = "+07:00";

/** Instant (ms) when booking opens for a night: a special day if one is set, else standard "N days before at HH:MM". */
export function opensAtFor(db: Db, serviceDate: string): number {
  const { standard, specials } = db.venue.schedule;
  const special = specials.find((s) => s.serviceDate === serviceDate);
  const date = special ? special.opensOn : addDays(serviceDate, -standard.daysBefore);
  return Date.parse(`${date}T${special ? special.time : standard.time}:00${BANGKOK}`);
}

export const availableAtFor = (db: Db, date: string) => Math.max(opensAtFor(db, date), Date.parse(db.venue.holdUntil));

export const isServiceNightOpen = (db: Db, date: string) =>
  db.venue.schedule.openWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())
  && !db.venue.schedule.closures.some((c) => c.serviceDate === date);
export const isNightOpen = (db: Db, serviceDate: string, now = Date.now()) =>
  isServiceNightOpen(db, serviceDate) && now >= availableAtFor(db, serviceDate);

/** Nights inside the booking window whose release time has already passed. */
export function bookingSchedule(db: Db, now = Date.now()) {
  const openNights: string[] = [];
  const upcomingNights: { serviceDate: string; opensAt: string }[] = [];
  let first = Infinity;
  for (let i = 0; i <= db.venue.maxAdvanceDays; i++) {
    const date = addDays(today(new Date(now)), i);
    if (!isServiceNightOpen(db, date)) continue;
    const at = availableAtFor(db, date);
    first = Math.min(first, at);
    if (now >= at) openNights.push(date);
    else upcomingNights.push({ serviceDate: date, opensAt: new Date(at).toISOString() });
  }
  return { openNights, upcomingNights, open: openNights.length > 0,
    opensAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
    secondsUntilOpen: Number.isFinite(first) ? Math.max(0, Math.ceil((first - now) / 1000)) : 0 };
}
