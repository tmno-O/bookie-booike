import { ApiError } from "@/lib/errors";
import { PARTY_SIZE, tablesFor, today, type Db, type Zone } from "./db";

/** Zones with seat usage for one night (confirmed bookings only; pending requests hold no seats). */
export function zoneRows(db: Db, date: string) {
  return db.zones.map((z) => {
    const booked = db.bookings.filter((b) => b.serviceDate === date && b.zoneId === z.id && b.status !== "pending");
    return {
      id: z.id, name: z.name, seats: z.seats, status: z.status, tables: tablesFor(z),
      tablesUsed: booked.length, bookedSeats: booked.reduce((sum, b) => sum + PARTY_SIZE[b.party], 0),
    };
  });
}

export function assertNameFree(db: Db, name: string, exceptId?: string) {
  if (db.zones.some((z) => z.id !== exceptId && z.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, "ZONE_NAME_TAKEN", "A zone with this name already exists");
  }
}

/** Capacity can't drop below what is already booked on any upcoming night. */
export function assertCapacityCovers(db: Db, zone: Zone, seats: number) {
  const tables = Math.max(1, Math.ceil(seats / 12));
  const perNight = new Map<string, number>();
  for (const b of db.bookings) {
    if (b.zoneId === zone.id && b.status !== "pending" && b.serviceDate >= today()) {
      perNight.set(b.serviceDate, (perNight.get(b.serviceDate) ?? 0) + 1);
    }
  }
  const worst = Math.max(0, ...perNight.values());
  if (worst > tables) {
    throw new ApiError(409, "CAPACITY_BELOW_BOOKED", `Capacity is too low: ${worst} tables are already booked on one night`);
  }
}
