import { addDays, today, type Db } from "./db";

const BANGKOK = "+07:00";

/** Instant (ms) when booking opens for a night: a special day if one is set, else standard "N days before at HH:MM". */
export function opensAtFor(db: Db, serviceDate: string): number {
  const { standard, specials } = db.venue.schedule;
  const special = specials.find((s) => s.serviceDate === serviceDate);
  const date = special ? special.opensOn : addDays(serviceDate, -standard.daysBefore);
  return Date.parse(`${date}T${special ? special.time : standard.time}:00${BANGKOK}`);
}

/** The queue opens when the first bookable night opens (and any test hold has passed). */
export function queueOpensAt(db: Db): number {
  let earliest = Infinity;
  for (let i = 0; i <= db.venue.maxAdvanceDays; i++) earliest = Math.min(earliest, opensAtFor(db, addDays(today(), i)));
  return Math.max(earliest, Date.parse(db.venue.holdUntil));
}

export const isNightOpen = (db: Db, serviceDate: string, now = Date.now()) => now >= opensAtFor(db, serviceDate);
