import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Mock JSON "database" for local end-to-end testing. Single-process only:
// writes are serialised with an in-memory lock and saved atomically to one JSON file.

export type Zone = { id: string; name: string; tables: number; seats: number };
export type QueueEntry = {
  id: string; customerId: string; name: string; phone: string;
  createdAt: string; startPosition: number; bookingId: string | null;
};
export type Booking = {
  id: string; reference: string; requestId: string; customerId: string; name: string; phone: string;
  serviceDate: string; party: string; zoneId: string; zoneName: string; createdAt: string;
  status: BookingStatus; channel: "line" | "staff"; checkedInAt?: string;
};
export type BookingStatus = "pending" | "confirmed" | "checked_in";
export type LineUser = { id: string; userId: string; displayName: string; createdAt: string };
export type Db = {
  venue: { slug: string; name: string; timezone: string; opensAt: string; queueStepSeconds: number; maxAdvanceDays: number };
  zones: Zone[];
  lineUsers: LineUser[];
  queue: QueueEntry[];
  bookings: Booking[];
  seq: number;
};

export const PARTIES = ["1-4", "5-8", "9-12", "12+"] as const;
/** Rough headcount per party bucket, used for dashboard guest totals and zone seat usage. */
export const PARTY_SIZE: Record<string, number> = { "1-4": 4, "5-8": 8, "9-12": 12, "12+": 15 };
export const QUEUE_AHEAD = 11; // people already waiting in front of the first customer
const TZ = "Asia/Bangkok";

export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: TZ }).format(now);
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function seed(opts: { opensInSeconds?: number; queueStepSeconds?: number } = {}): Db {
  const now = new Date();
  const day = today(now);
  const zones: Zone[] = [
    { id: "zone-vip", name: "VIP", tables: 2, seats: 24 },
    { id: "zone-indoor", name: "Indoor", tables: 4, seats: 48 },
    { id: "zone-outdoor", name: "Outdoor", tables: 4, seats: 60 },
  ];
  const [vip, indoor, outdoor] = zones;
  const existing = (seq: number, name: string, phone: string, party: string, zone: Zone,
    status: BookingStatus, channel: "line" | "staff"): Booking => ({
    id: `seed-${seq}`, reference: `BL-${day.slice(0, 4)}-${String(seq).padStart(4, "0")}`, requestId: `seed-req-${seq}`,
    customerId: `seed-customer-${seq}`, name, phone, serviceDate: day, party,
    zoneId: zone.id, zoneName: zone.name, createdAt: now.toISOString(), status, channel,
  });
  return {
    venue: {
      slug: "bookie-demo", name: "Bookie lyon.", timezone: TZ, maxAdvanceDays: 6,
      opensAt: new Date(now.getTime() + (opts.opensInSeconds ?? 0) * 1000).toISOString(),
      queueStepSeconds: opts.queueStepSeconds ?? 2,
    },
    zones,
    lineUsers: [],
    queue: [],
    // Tonight's sample bookings (same as the admin design). VIP has 1 of 2 tables taken,
    // so one more customer booking fills it.
    bookings: [
      existing(1, "เจ๊ม่อน", "0919119911", "12+", outdoor, "confirmed", "line"),
      existing(2, "คุณเมย์", "0812345678", "5-8", indoor, "pending", "line"),
      existing(3, "คุณนัท", "0893456789", "1-4", vip, "checked_in", "staff"),
      existing(4, "คุณแพรว", "0824567890", "5-8", outdoor, "confirmed", "line"),
    ],
    seq: 4,
  };
}

const file = () => process.env.MOCK_DB_PATH ?? path.join(process.cwd(), ".mock", "db.json");
let lock: Promise<unknown> = Promise.resolve();

async function load(): Promise<Db> {
  try {
    const db = JSON.parse(await readFile(file(), "utf8")) as Db;
    db.lineUsers ??= []; // databases saved before LINE login existed
    const seats: Record<string, number> = { VIP: 24, Indoor: 48, Outdoor: 60 };
    for (const z of db.zones) z.seats ??= seats[z.name] ?? 20;
    for (const b of db.bookings) { b.status ??= "confirmed"; b.channel ??= "line"; }
    return db;
  } catch {
    return seed();
  }
}
async function save(db: Db) {
  await mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, file());
}

/** Run `fn` against the database; changes are saved when it returns. */
export function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = lock.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

export const reset = (opts?: Parameters<typeof seed>[0]) => withDb((db) => { Object.assign(db, seed(opts)); });

export function queueState(db: Db, entry: QueueEntry, now = Date.now()) {
  const step = db.venue.queueStepSeconds;
  const advanced = step <= 0 ? Infinity : Math.floor((now - Date.parse(entry.createdAt)) / (step * 1000));
  const position = Math.max(1, entry.startPosition - advanced);
  return { position, ready: position === 1 };
}

export function zoneAvailability(db: Db, date: string) {
  return db.zones.map((zone) => {
    const left = zone.tables - db.bookings.filter((b) => b.serviceDate === date && b.zoneId === zone.id).length;
    return { id: zone.id, name: zone.name, tablesLeft: Math.max(0, left), available: left > 0 };
  });
}
